// Call state machine
export type CallState = 'idle' | 'calling' | 'ringing' | 'connecting' | 'connected' | 'reconnecting' | 'ended';

export type CallRole = 'caller' | 'receiver';

export type ConnectionQuality = 'excellent' | 'good' | 'poor' | 'reconnecting';

export interface CallInfo {
  callId: string;
  callerId: string;
  callerName: string;
  receiverId: string;
  receiverName: string;
  startedAt: number;
}

export interface CallStats {
  rtt: number;           // Round-trip time in ms
  packetLoss: number;    // 0-100 percentage
  jitter: number;        // in ms
  bytesSent: number;
  bytesReceived: number;
  audioLevel: number;    // 0-1
}

// Socket.IO signaling event payloads
export interface SignalCallUser {
  callId: string;
  callerId: string;
  callerName: string;
  receiverId: string;
}

export interface SignalIncomingCall {
  callId: string;
  callerId: string;
  callerName: string;
}

export interface SignalCallAccepted {
  callId: string;
  callerId: string;
  receiverId: string;
  receiverName: string;
}

export interface SignalCallRejected {
  callId: string;
  receiverId: string;
  reason?: string;
}

export interface SignalOffer {
  callId: string;
  fromUserId: string;
  offer: RTCSessionDescriptionInit;
}

export interface SignalAnswer {
  callId: string;
  fromUserId: string;
  answer: RTCSessionDescriptionInit;
}

export interface SignalIceCandidate {
  callId: string;
  fromUserId: string;
  candidate: RTCIceCandidateInit;
}

export interface SignalEndCall {
  callId: string;
  fromUserId: string;
  reason?: string;
}

export interface SignalCallEnded {
  callId: string;
  reason?: string;
}

export interface OnlineUser {
  userId: string;
  userName: string;
  socketId: string;
}

// Generate unique call ID
export function generateCallId(): string {
  return `call_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
