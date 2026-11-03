/** Signaling and call-state types shared between client and server. */

export interface UserInfo {
  id: string;
  name: string;
  online: boolean;
  inCall: boolean;
}

export type CallPhase =
  | 'idle'
  | 'outgoing'
  | 'incoming'
  | 'active'
  | 'ended'
  | 'failed';

export type ConnectionState =
  | 'new'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed'
  | 'closed';

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface CallSession {
  callId: string;
  peerId: string;
  peerName: string;
  phase: CallPhase;
  startedAt: number | null;
  endReason: string | null;
}

export interface NetworkMetrics {
  available: boolean;
  packetsSent: number;
  packetsLost: number;
  packetLossPercent: number;
  jitterMs: number;
  roundTripMs: number;
  jitterBufferMs: number;
  bytesReceived: number;
  bitrateKbps: number;
  inboundBitrateKbps: number;
  codec: string;
  resolution: string;
}

export const EMPTY_NETWORK_METRICS: NetworkMetrics = {
  available: false,
  packetsSent: 0,
  packetsLost: 0,
  packetLossPercent: 0,
  jitterMs: 0,
  roundTripMs: 0,
  jitterBufferMs: 0,
  bytesReceived: 0,
  bitrateKbps: 0,
  inboundBitrateKbps: 0,
  codec: '-',
  resolution: '-',
};

/** Socket event names - single source of truth for both sides. */
export const SIGNAL = {
  // client -> server
  REGISTER: 'cv:register',
  RENAME: 'cv:rename',
  DIAL: 'cv:dial',
  ACCEPT: 'cv:accept',
  REJECT: 'cv:reject',
  HANGUP: 'cv:hangup',
  OFFER: 'cv:offer',
  ANSWER: 'cv:answer',
  ICE: 'cv:ice',
  // server -> client
  ICE_CONFIG: 'cv:ice-config',
  DIRECTORY: 'cv:directory',
  INCOMING: 'cv:incoming',
  DIALING: 'cv:dialing',
  ACCEPTED: 'cv:accepted',
  REJECTED: 'cv:rejected',
  ENDED: 'cv:ended',
  OFFER_TO: 'cv:offer-to',
  ANSWER_TO: 'cv:answer-to',
  ICE_TO: 'cv:ice-to',
  PEER_LOST: 'cv:peer-lost',
  ERROR: 'cv:error',
} as const;

export interface OfferPayload {
  callId: string;
  to: string;
  sdp: string;
}

export interface AnswerPayload {
  callId: string;
  to: string;
  sdp: string;
}

export interface IcePayload {
  callId: string;
  to: string;
  candidate: RTCIceCandidateInit | null;
}

export interface CallTargetPayload {
  callId: string;
  to?: string;
  from?: string;
}

export interface DialPayload {
  to: string;
}

export interface RegisterPayload {
  name: string;
}

export interface ErrorPayload {
  code: string;
  message: string;
}

export interface IncomingPayload extends ErrorPayload {
  code: 'incoming';
  callId: string;
  from: string;
  fromName: string;
}
