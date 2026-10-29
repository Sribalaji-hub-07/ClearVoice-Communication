import type { CallState, CallInfo, CallStats, ConnectionQuality } from '../types/call';

export interface WebRTCCallbacks {
  onStateChange: (state: CallState) => void;
  onRemoteStream: (stream: MediaStream) => void;
  onStats: (stats: CallStats, quality: ConnectionQuality) => void;
  onError: (message: string) => void;
}

export class WebRTCCallManager {
  private pc: RTCPeerConnection | null = null;
  private state: CallState = 'idle';
  private callInfo: CallInfo | null = null;
  private pendingIceCandidates: RTCIceCandidateInit[] = [];
  private remoteDescriptionSet: boolean = false;
  private statsInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private localStream: MediaStream | null = null;
  private remoteAudioElement: HTMLAudioElement | null = null;

  public onIceCandidate?: (candidate: RTCIceCandidateInit) => void;

  constructor(private callbacks: WebRTCCallbacks) {}

  public createPeerConnection(iceServers?: RTCIceServer[]): RTCPeerConnection {
    const defaultServers: RTCIceServer[] = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun.relay.metered.ca:80' },
      {
        urls: 'turn:standard.relay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'turn:standard.relay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'turn:standard.relay.metered.ca:443?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      }
    ];

    const config: RTCConfiguration = {
      iceServers: iceServers && iceServers.length > 0 ? iceServers : defaultServers,
      iceCandidatePoolSize: 10,
    };

    console.log('[WEBRTC] Creating RTCPeerConnection with config', config);
    this.pc = new RTCPeerConnection(config);

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('[ICE] Generated local ICE candidate');
        this.onIceCandidate?.(event.candidate);
      }
    };

    this.pc.ontrack = (event) => {
      console.log('[AUDIO] Remote track received');
      const remoteStream = event.streams[0] || new MediaStream([event.track]);
      
      if (!this.remoteAudioElement) {
        this.remoteAudioElement = document.createElement('audio');
        this.remoteAudioElement.autoplay = true;
        this.remoteAudioElement.setAttribute('playsinline', 'true');
        this.remoteAudioElement.style.display = 'none';
        document.body.appendChild(this.remoteAudioElement);
      }
      this.remoteAudioElement.srcObject = remoteStream;
      this.remoteAudioElement.play().catch((err) => {
        console.warn('[AUDIO] Autoplay blocked, will play on next user gesture:', err);
      });
      
      this.callbacks.onRemoteStream(remoteStream);
    };

    this.pc.oniceconnectionstatechange = () => {
      const state = this.pc?.iceConnectionState;
      console.log('[WEBRTC] ICE Connection State:', state);
      
      if (state === 'checking') {
        this.setState('connecting');
      } else if (state === 'connected' || state === 'completed') {
        this.setState('connected');
        this.startStatsCollection();
        if (this.reconnectTimeout) {
          clearTimeout(this.reconnectTimeout);
          this.reconnectTimeout = null;
        }
      } else if (state === 'disconnected') {
        this.setState('reconnecting');
        this.reconnectTimeout = setTimeout(() => {
          if (this.state === 'reconnecting') {
             this.setState('ended');
          }
        }, 10000);
      } else if (state === 'failed') {
        console.log('[WEBRTC] ICE failed, attempting restart');
        this.pc?.restartIce();
        // If it's already failed we could wait or just end
        if (this.state === 'reconnecting') {
           setTimeout(() => {
               if (this.pc?.iceConnectionState === 'failed') {
                   this.setState('ended');
               }
           }, 5000);
        }
      } else if (state === 'closed') {
        this.setState('ended');
      }
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc?.connectionState;
      console.log('[WEBRTC] Connection State:', state);
      
      if (state === 'failed') {
        this.setState('ended');
      } else if (state === 'closed') {
        this.setState('ended');
      }
    };

    this.pc.onsignalingstatechange = () => {
      console.log('[WEBRTC] Signaling State:', this.pc?.signalingState);
    };

    this.pc.onicegatheringstatechange = () => {
      console.log('[ICE] Gathering State:', this.pc?.iceGatheringState);
    };

    return this.pc;
  }

  public addLocalTrack(stream: MediaStream): void {
    if (!this.pc) {
      console.error('[WEBRTC] Cannot add local track: PeerConnection not created');
      return;
    }
    
    this.localStream = stream;
    const audioTrack = stream.getAudioTracks()[0];
    
    if (audioTrack && audioTrack.enabled) {
      this.pc.addTrack(audioTrack, stream);
      console.log('[AUDIO] Local audio track added');
    } else {
      console.warn('[AUDIO] No valid audio track found in the provided stream');
    }
  }

  public async createOffer(): Promise<RTCSessionDescriptionInit> {
    if (!this.pc) throw new Error('PeerConnection not created');
    
    console.log('[WEBRTC] Creating offer');
    const offer = await this.pc.createOffer();
    console.log('[WEBRTC] Setting local description');
    await this.pc.setLocalDescription(offer);
    
    return offer;
  }

  public async handleOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    if (!this.pc) throw new Error('PeerConnection not created');
    
    console.log('[WEBRTC] Handling offer and setting remote description');
    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    this.remoteDescriptionSet = true;
    
    await this.flushPendingIceCandidates();
    
    console.log('[WEBRTC] Creating answer');
    const answer = await this.pc.createAnswer();
    console.log('[WEBRTC] Setting local description');
    await this.pc.setLocalDescription(answer);
    
    return answer;
  }

  public async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.pc) throw new Error('PeerConnection not created');
    
    console.log('[WEBRTC] Handling answer and setting remote description');
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
    this.remoteDescriptionSet = true;
    
    await this.flushPendingIceCandidates();
  }

  public async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (this.remoteDescriptionSet && this.pc) {
      console.log('[ICE] Adding ICE candidate immediately');
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } else {
      console.log('[ICE] Queuing ICE candidate until remote description is set');
      this.pendingIceCandidates.push(candidate);
    }
  }

  private async flushPendingIceCandidates(): Promise<void> {
    if (!this.pc) return;
    
    if (this.pendingIceCandidates.length > 0) {
      console.log(`[ICE] Flushing ${this.pendingIceCandidates.length} pending candidates`);
      for (const candidate of this.pendingIceCandidates) {
        try {
          await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.error('[ICE] Error adding pending candidate', e);
        }
      }
      this.pendingIceCandidates = [];
    }
  }

  private startStatsCollection(): void {
    if (this.statsInterval) {
      this.stopStatsCollection();
    }
    
    this.statsInterval = setInterval(async () => {
      if (!this.pc) return;
      
      try {
        const stats = await this.pc.getStats();
        
        let rtt = 0;
        let packetsLost = 0;
        let packetsReceived = 0;
        let jitter = 0;
        let bytesSent = 0;
        let bytesReceived = 0;
        
        stats.forEach((report) => {
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            rtt = report.currentRoundTripTime * 1000 || 0; // Convert to ms
          }
          if (report.type === 'inbound-rtp' && report.kind === 'audio') {
            packetsLost = report.packetsLost || 0;
            packetsReceived = report.packetsReceived || 0;
            jitter = report.jitter * 1000 || 0;
            bytesReceived = report.bytesReceived || 0;
          }
          if (report.type === 'outbound-rtp') {
            bytesSent = report.bytesSent || 0;
          }
        });
        
        let packetLossPercent = 0;
        if (packetsReceived + packetsLost > 0) {
          packetLossPercent = (packetsLost / (packetsReceived + packetsLost)) * 100;
        }
        
        let quality: ConnectionQuality = 'poor';
        if (rtt < 100 && packetLossPercent < 2) {
          quality = 'excellent';
        } else if (rtt < 200 && packetLossPercent < 5) {
          quality = 'good';
        } else {
          quality = 'poor';
        }
        
        const callStats: CallStats = {
          rtt,
          packetLoss: packetLossPercent,
          jitter,
          bytesSent,
          bytesReceived,
          audioLevel: 1
        };
        
        this.callbacks.onStats(callStats, quality);
      } catch (e) {
        console.error('[WEBRTC] Failed to get stats', e);
      }
    }, 2000);
  }

  private stopStatsCollection(): void {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
  }

  public cleanup(): void {
    console.log('[CALL] cleanup');
    this.stopStatsCollection();
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    
    if (this.remoteAudioElement) {
      if (this.remoteAudioElement.parentNode) {
        this.remoteAudioElement.parentNode.removeChild(this.remoteAudioElement);
      }
      this.remoteAudioElement = null;
    }
    
    this.localStream = null;
    this.pendingIceCandidates = [];
    this.remoteDescriptionSet = false;
    
    this.setState('idle');
    console.log(`[CALL] Cleanup completed for call ${this.callInfo?.callId}`);
    this.callInfo = null;
  }

  public setLocalAudioEnabled(enabled: boolean): void {
    if (this.localStream) {
      const track = this.localStream.getAudioTracks()[0];
      if (track) {
        track.enabled = enabled;
        console.log(`[AUDIO] Local track enabled set to ${enabled}`);
      }
    }
  }

  public getState(): CallState {
    return this.state;
  }

  public getCallInfo(): CallInfo | null {
    return this.callInfo;
  }
  
  public setCallInfo(info: CallInfo | null): void {
      this.callInfo = info;
  }

  private setState(newState: CallState): void {
    const validTransitions: Record<string, CallState[]> = {
      idle: ['calling', 'ringing', 'ended'],
      calling: ['connecting', 'ended'],
      ringing: ['connecting', 'ended'],
      connecting: ['connected', 'ended'],
      connected: ['reconnecting', 'ended'],
      reconnecting: ['connected', 'ended'],
      ended: ['idle']
    };

    const allowed = validTransitions[this.state];
    
    // Always allow transitioning to ended just in case
    if (newState === 'ended' || (allowed && allowed.includes(newState))) {
      console.log(`[CALL] State transition: ${this.state} -> ${newState}`);
      this.state = newState;
      this.callbacks.onStateChange(this.state);
    } else {
      console.warn(`[CALL] Invalid state transition attempted: ${this.state} -> ${newState}`);
    }
  }
}
