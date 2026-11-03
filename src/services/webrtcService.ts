import type { ConnectionState, IceServerConfig, NetworkMetrics } from '../types/call';
import { EMPTY_NETWORK_METRICS } from '../types/call';

export interface PeerHandlers {
  onLocalSdp: (kind: 'offer' | 'answer', sdp: string) => void;
  onLocalIce: (candidate: RTCIceCandidateInit | null) => void;
  onState: (connection: ConnectionState, ice: RTCIceConnectionState, signaling: RTCSignalingState) => void;
  onRemoteStream: (stream: MediaStream) => void;
  onFailure: (message: string) => void;
}

/**
 * One RTCPeerConnection per call. Owns the trickle-ICE queue, the negotiation
 * guard and the restart logic, and always sends the processed audio track it
 * was handed - never the raw microphone stream.
 */
export class CallPeer {
  readonly pc: RTCPeerConnection;
  private pendingIce: RTCIceCandidateInit[] = [];
  private remoteDescriptionSet = false;
  private negotiating = false;
  private restartAttempted = false;
  private closed = false;
  private stream: MediaStream | null = null;

  constructor(iceServers: IceServerConfig[], localTrack: MediaStreamTrack, private handlers: PeerHandlers, private role: 'caller' | 'callee') {
    const config: RTCConfiguration = {
      iceServers: iceServers.map((s) => ({ urls: s.urls, username: s.username, credential: s.credential })),
      iceCandidatePoolSize: 2,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    };
    this.pc = new RTCPeerConnection(config);
    this.pc.addTrack(localTrack, new MediaStream([localTrack]));

    this.pc.onnegotiationneeded = () => {
      void this.negotiate();
    };

    this.pc.onicecandidate = (event) => {
      this.handlers.onLocalIce(event.candidate ? event.candidate.toJSON() : null);
    };

    this.pc.ontrack = (event) => {
      const incoming = event.streams[0];
      if (!incoming) return;
      if (this.stream === incoming) return; // duplicate event guard
      this.stream = incoming;
      this.handlers.onRemoteStream(incoming);
    };

    const publish = () =>
      this.handlers.onState(this.pc.connectionState as ConnectionState, this.pc.iceConnectionState, this.pc.signalingState);

    this.pc.onconnectionstatechange = () => {
      publish();
      const state = this.pc.connectionState;
      if (state === 'failed') void this.tryRecover('Peer connection failed');
      if (state === 'disconnected' && !this.restartAttempted) void this.tryRecover('Peer connection dropped');
    };
    this.pc.oniceconnectionstatechange = () => {
      publish();
      if (this.pc.iceConnectionState === 'failed') void this.tryRecover('ICE negotiation failed');
    };
    this.pc.onsignalingstatechange = () => publish();
    publish();
  }

  get remoteStream(): MediaStream | null {
    return this.stream;
  }

  /** Caller kicks negotiation off; the callee simply waits for the offer. */
  async start(): Promise<void> {
    if (this.role === 'caller') await this.negotiate();
  }

  private async negotiate(): Promise<void> {
    if (this.closed || this.negotiating) return;
    this.negotiating = true;
    try {
      const offer = await this.pc.createOffer();
      if (this.pc.signalingState === 'stable') await this.pc.setLocalDescription(offer);
      this.handlers.onLocalSdp('offer', offer.sdp ?? '');
    } catch (err) {
      this.handlers.onFailure(`Could not create the offer: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.negotiating = false;
    }
  }

  async handleOffer(sdp: string): Promise<void> {
    if (this.closed) return;
    try {
      await this.pc.setRemoteDescription({ type: 'offer', sdp });
      this.remoteDescriptionSet = true;
      await this.drainIce();
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.handlers.onLocalSdp('answer', answer.sdp ?? '');
    } catch (err) {
      this.handlers.onFailure(`Could not answer the offer: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async handleAnswer(sdp: string): Promise<void> {
    if (this.closed) return;
    try {
      await this.pc.setRemoteDescription({ type: 'answer', sdp });
      this.remoteDescriptionSet = true;
      await this.drainIce();
    } catch (err) {
      this.handlers.onFailure(`Could not apply the answer: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Queue candidates that arrive before the remote description exists. */
  async handleRemoteIce(candidate: RTCIceCandidateInit | null): Promise<void> {
    if (this.closed) return;
    if (!candidate) return;
    if (!this.remoteDescriptionSet) {
      this.pendingIce.push(candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(candidate);
    } catch (err) {
      this.handlers.onFailure(`Rejected an ICE candidate: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async drainIce(): Promise<void> {
    const queued = this.pendingIce;
    this.pendingIce = [];
    for (const candidate of queued) {
      try {
        await this.pc.addIceCandidate(candidate);
      } catch {
        /* stale candidate after restart - safe to drop */
      }
    }
  }

  /** One automatic ICE restart per call, then surface the failure to the UI. */
  private async tryRecover(reason: string): Promise<void> {
    if (this.closed || this.restartAttempted) {
      if (!this.closed) this.handlers.onFailure(`${reason}. Restarting is not possible.`);
      return;
    }
    this.restartAttempted = true;
    try {
      this.pc.restartIce();
      this.handlers.onFailure(`${reason}. Attempting an ICE restart.`);
    } catch (err) {
      this.handlers.onFailure(`${reason}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  setMuted(muted: boolean): void {
    for (const sender of this.pc.getSenders()) {
      if (sender.track) sender.track.enabled = !muted;
    }
  }

  /**
   * Pulls the figures the browser actually measured. The WebRTC stats dictionary is
   * still only partially typed in lib.dom, so the entries are read generically.
   */
  async getNetworkMetrics(): Promise<NetworkMetrics> {
    const report = await this.pc.getStats();
    const entries: RawStats[] = [];
    report.forEach((value) => entries.push(value as unknown as RawStats));

    const inbound = entries.find((e) => e.type === 'inbound-rtp' && e.kind === 'audio');
    const outbound = entries.find((e) => e.type === 'outbound-rtp' && e.kind === 'audio');
    const nominatedPair = entries.find((e) => e.type === 'candidate-pair' && e.nominated === true && e.state === 'succeeded');
    const transport = entries.find((e) => e.type === 'transport' && typeof e.selectedCandidatePairId === 'string');
    const transportPair = transport
      ? entries.find((e) => e.type === 'candidate-pair' && e.id === transport.selectedCandidatePairId)
      : undefined;
    const pair = nominatedPair ?? transportPair;
    const remote = entries.find((e) => e.type === 'remote-candidate');
    const local = entries.find((e) => e.type === 'local-candidate');

    if (!inbound && !outbound) return { ...EMPTY_NETWORK_METRICS };

    const received = num(inbound, 'packetsReceived');
    const lost = num(inbound, 'packetsLost');
    const expected = received + lost;
    const jitterSeconds = num(inbound, 'jitter');
    const rtt = num(pair, 'currentRoundTripTime');
    const jbDelay = num(inbound, 'jitterBufferDelay');
    const jbEmitted = num(inbound, 'jitterBufferEmittedCount');
    const bytesReceived = num(inbound, 'bytesReceived');
    const targetBitrate = num(outbound, 'targetBitrate');
    const inboundBitrate = num(inbound, 'bitrate');

    const resolution =
      remote && local
        ? `${String(local.candidateType ?? '?')} -> ${String(remote.candidateType ?? '?')}`
        : 'n/a';

    return {
      available: true,
      packetsSent: num(outbound, 'packetsSent'),
      packetsLost: lost,
      packetLossPercent: expected ? (lost / expected) * 100 : 0,
      jitterMs: jitterSeconds * 1000,
      roundTripMs: rtt * 1000,
      jitterBufferMs: jbEmitted ? (jbDelay / jbEmitted) * 1000 : 0,
      bytesReceived,
      bitrateKbps: targetBitrate ? targetBitrate / 1000 : 0,
      inboundBitrateKbps: inboundBitrate ? inboundBitrate / 1000 : 0,
      codec: str(inbound, 'mimeType') || describeCodec(entries, inbound?.codecId),
      resolution,
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.pendingIce = [];
    this.pc.onnegotiationneeded = null;
    this.pc.onicecandidate = null;
    this.pc.ontrack = null;
    this.pc.onconnectionstatechange = null;
    this.pc.oniceconnectionstatechange = null;
    this.pc.onsignalingstatechange = null;
    try {
      // The processed track belongs to the shared audio engine, so it is never
      // stopped here - only the peer connection is torn down.
      this.pc.close();
    } catch {
      /* already closed */
    }
    this.stream = null;
  }
}

type RawStats = { type?: string; id?: string; [key: string]: unknown };

function num(stats: RawStats | undefined, key: string): number {
  const value = stats?.[key];
  return typeof value === 'number' && isFinite(value) ? value : 0;
}

function str(stats: RawStats | undefined, key: string): string {
  const value = stats?.[key];
  return typeof value === 'string' ? value : '';
}

function describeCodec(entries: RawStats[], codecId?: unknown): string {
  if (typeof codecId !== 'string') return 'audio';
  const codec = entries.find((e) => e.type === 'codec' && e.id === codecId);
  const mime = str(codec, 'mimeType');
  return mime ? mime.replace('audio/', '') : 'audio';
}

export function isWebRtcSupported(): boolean {
  return typeof window !== 'undefined' && typeof RTCPeerConnection !== 'undefined' && !!navigator.mediaDevices;
}
