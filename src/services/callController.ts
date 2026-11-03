import { socketService } from './socketService';
import { sessionStore } from './sessionStore';
import { CallPeer, type PeerHandlers } from './webrtcService';
import { recordCall } from './callHistory';
import type { CallPhase, ConnectionState, NetworkMetrics } from '../types/call';
import { EMPTY_NETWORK_METRICS, SIGNAL } from '../types/call';

export interface CallState {
  phase: CallPhase;
  callId: string | null;
  peerId: string | null;
  peerName: string | null;
  incomingFrom: string | null;
  startedAt: number | null;
  endReason: string | null;
  connection: ConnectionState;
  ice: RTCIceConnectionState;
  failure: string | null;
  muted: boolean;
  metrics: NetworkMetrics;
  hasRemoteAudio: boolean;
  remoteStream: MediaStream | null;
}

const IDLE: CallState = {
  phase: 'idle',
  callId: null,
  peerId: null,
  peerName: null,
  incomingFrom: null,
  startedAt: null,
  endReason: null,
  connection: 'new',
  ice: 'new',
  failure: null,
  muted: false,
  metrics: { ...EMPTY_NETWORK_METRICS },
  hasRemoteAudio: false,
  remoteStream: null,
};

/**
 * Bridges Socket.IO signaling and RTCPeerConnection.
 * Singleton so a route change can never open two peer connections or bind
 * duplicate listeners.
 */
class CallController {
  private state: CallState = { ...IDLE };
  private listeners = new Set<() => void>();
  private peer: CallPeer | null = null;
  private getTrack: (() => MediaStreamTrack | null) | null = null;
  private statsTimer: number | null = null;
  private bound = false;

  getState(): CallState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(patch: Partial<CallState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** The engine supplies the processed track at dial time, so audio is always the filtered one. */
  bindTrackProvider(provider: () => MediaStreamTrack | null): void {
    this.getTrack = provider;
  }

  bindSignaling(): void {
    if (this.bound) return;
    this.bound = true;

    socketService.on<{ callId: string; from: string; fromName: string }>(SIGNAL.INCOMING, (payload) => {
      if (this.state.phase !== 'idle') {
        socketService.emit(SIGNAL.REJECT, { callId: payload.callId });
        return;
      }
      this.set({ phase: 'incoming', callId: payload.callId, incomingFrom: payload.from, peerId: payload.from, peerName: payload.fromName });
    });

    socketService.on<{ callId: string; to: string; toName: string }>(SIGNAL.DIALING, (payload) => {
      this.set({ phase: 'outgoing', callId: payload.callId, peerId: payload.to, peerName: payload.toName });
    });

    socketService.on<{ callId: string; from: string; fromName: string }>(SIGNAL.ACCEPTED, (payload) => {
      if (payload.callId !== this.state.callId) return;
      this.set({ phase: 'active', startedAt: Date.now(), peerId: payload.from, peerName: payload.fromName });
      this.startPeer();
    });

    socketService.on<{ callId: string; sdp: string }>(SIGNAL.OFFER_TO, (payload) => {
      if (payload.callId !== this.state.callId || !this.peer) return;
      void this.peer.handleOffer(payload.sdp);
    });

    socketService.on<{ callId: string; sdp: string }>(SIGNAL.ANSWER_TO, (payload) => {
      if (payload.callId !== this.state.callId || !this.peer) return;
      void this.peer.handleAnswer(payload.sdp);
    });

    socketService.on<{ callId: string; candidate: RTCIceCandidateInit | null }>(SIGNAL.ICE_TO, (payload) => {
      if (payload.callId !== this.state.callId || !this.peer) return;
      void this.peer.handleRemoteIce(payload.candidate);
    });

    socketService.on<{ callId: string; code: string }>(SIGNAL.REJECTED, (payload) => {
      if (payload.callId !== this.state.callId) return;
      this.teardown(payload.code);
    });
    socketService.on<{ callId: string; code: string }>(SIGNAL.ENDED, (payload) => {
      if (payload.callId && payload.callId !== this.state.callId) return;
      this.teardown(payload.code);
    });
    socketService.on<{ code: string; message: string }>(SIGNAL.PEER_LOST, (payload) => {
      this.teardown(payload.code, payload.message);
    });

    socketService.on<{ code: string; message: string }>(SIGNAL.ERROR, (payload) => {
      if (payload.code === 'busy' || payload.code === 'offline' || payload.code === 'self-call') {
        this.set({ failure: payload.message });
      }
    });
  }

  dial(to: string): void {
    if (this.state.phase !== 'idle') return;
    if (!this.getTrack?.()) {
      this.set({ failure: 'Start noise processing before placing a call.' });
      return;
    }
    this.bindSignaling();
    this.set({ phase: 'outgoing', peerId: to, peerName: to, callId: null, failure: null, endReason: null });
    socketService.emit(SIGNAL.DIAL, { to });
  }

  accept(): void {
    const callId = this.state.callId;
    if (!callId || this.state.phase !== 'incoming') return;
    if (!this.getTrack?.()) {
      socketService.emit(SIGNAL.REJECT, { callId });
      this.teardown('no-audio', 'Start noise processing before accepting a call.');
      return;
    }
    socketService.emit(SIGNAL.ACCEPT, { callId });
    this.set({ phase: 'active', startedAt: Date.now(), peerName: this.state.peerName });
    this.startPeer();
  }

  reject(): void {
    if (this.state.callId) socketService.emit(SIGNAL.REJECT, { callId: this.state.callId });
    this.teardown('rejected');
  }

  hangup(): void {
    if (this.state.callId) socketService.emit(SIGNAL.HANGUP, { callId: this.state.callId });
    this.teardown('hangup');
  }

  setMuted(muted: boolean): void {
    this.peer?.setMuted(muted);
    this.set({ muted });
  }

  private startPeer(): void {
    if (this.peer) return; // duplicate negotiation guard
    const track = this.getTrack?.();
    if (!track) {
      this.set({ failure: 'No processed audio track available.' });
      return;
    }
    const callId = this.state.callId;
    const peerId = this.state.peerId;
    if (!callId || !peerId) return;

    const isCaller = this.state.phase !== 'active' || this.state.incomingFrom === null;
    const handlers: PeerHandlers = {
      onLocalSdp: (kind, sdp) => {
        if (kind === 'offer') socketService.emit(SIGNAL.OFFER, { callId, to: peerId, sdp });
        else socketService.emit(SIGNAL.ANSWER, { callId, to: peerId, sdp });
      },
      onLocalIce: (candidate) => socketService.emit(SIGNAL.ICE, { callId, to: peerId, candidate }),
      onState: (connection, ice) => this.set({ connection, ice }),
      onRemoteStream: (stream) => this.set({ hasRemoteAudio: true, remoteStream: stream, failure: null }),
      onFailure: (message) => this.set({ failure: message }),
    };

    this.peer = new CallPeer(sessionStore.getState().iceServers, track, handlers, isCaller ? 'caller' : 'callee');
    void this.peer.start();
    this.startStatsPolling();
  }

  private startStatsPolling(): void {
    if (this.statsTimer !== null) return;
    this.statsTimer = window.setInterval(async () => {
      if (!this.peer) return;
      const metrics = await this.peer.getNetworkMetrics();
      this.set({ metrics });
    }, 1000);
  }

  private stopStatsPolling(): void {
    if (this.statsTimer === null) return;
    window.clearInterval(this.statsTimer);
    this.statsTimer = null;
  }

  teardown(reason: string, message?: string): void {
    this.stopStatsPolling();
    this.peer?.close();
    this.peer = null;
    const { startedAt, peerId, peerName, incomingFrom } = this.state;
    if (startedAt && peerId && reason !== 'cleared') {
      recordCall({
        peerId,
        peerName: peerName ?? peerId,
        direction: incomingFrom ? 'in' : 'out',
        startedAt,
        endReason: message ?? reason,
      });
    }
    this.set({
      ...IDLE,
      phase: reason === 'hangup' || reason === 'rejected' || reason === 'peer-disconnected' ? 'ended' : 'failed',
      endReason: message ?? reason,
      failure: message ?? null,
    });
    window.setTimeout(() => {
      if (this.state.phase === 'ended' || this.state.phase === 'failed') this.set({ ...IDLE });
    }, 4000);
  }
}

export const callController = new CallController();
