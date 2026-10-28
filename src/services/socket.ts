import { io, Socket } from 'socket.io-client';
import type {
  SignalIncomingCall,
  SignalCallAccepted,
  SignalCallRejected,
  SignalOffer,
  SignalAnswer,
  SignalIceCandidate,
  SignalCallEnded,
  OnlineUser,
  SignalCallUser,
  SignalEndCall,
} from '../types/call';

let socket: Socket | null = null;
let onlineUsersCache: OnlineUser[] = [];
let iceServersCache: any[] | undefined = undefined;
type OnlineUsersUpdateHandler = (users: OnlineUser[]) => void;
let onlineUsersListeners: OnlineUsersUpdateHandler[] = [];

const notifyOnlineUsersUpdate = () => {
  onlineUsersListeners.forEach((handler) => handler(onlineUsersCache));
};

export const getSocket = (): Socket | null => {
  return socket;
};

export const connectSocket = (userId: string, userName: string): Socket => {
  if (socket) {
    if (socket.connected) {
      console.log('[SIGNAL] Socket already connected');
      return socket;
    }
    socket.disconnect();
  }

  const isProd = import.meta.env.PROD;
  // Fallback to hostname:3001 in dev so LAN devices (phones) connect to the host PC's server
  const url = import.meta.env.VITE_SIGNALING_URL || (isProd ? window.location.origin : `http://${window.location.hostname}:3001`);
  console.log(`[SIGNAL] Connecting to signaling server at ${url}`);

  socket = io(url, {
    auth: { userId, userName },
  });

  socket.on('connect', () => {
    console.log('[SIGNAL] Socket connected:', socket?.id);
  });

  socket.on('disconnect', () => {
    console.log('[SIGNAL] Socket disconnected');
  });

  socket.on('connect_error', (err) => {
    console.error('[SIGNAL] Connection error:', err.message);
  });

  socket.on('online-users', (users: OnlineUser[]) => {
    console.log('[SIGNAL] Received online users list', users);
    onlineUsersCache = users;
    notifyOnlineUsersUpdate();
  });

  socket.on('ice-servers', (servers: any[]) => {
    console.log('[SIGNAL] Received ICE servers', servers);
    iceServersCache = servers;
  });

  // Request ICE servers immediately upon connection
  socket.emit('get-ice-servers');

  socket.on('user-online', (user: OnlineUser) => {
    console.log('[SIGNAL] User online:', user);
    if (!onlineUsersCache.find((u) => u.userId === user.userId)) {
      onlineUsersCache.push(user);
      notifyOnlineUsersUpdate();
    }
  });

  socket.on('user-offline', (userId: string) => {
    console.log('[SIGNAL] User offline:', userId);
    onlineUsersCache = onlineUsersCache.filter((u) => u.userId !== userId);
    notifyOnlineUsersUpdate();
  });

  return socket;
};

export const disconnectSocket = (): void => {
  if (socket) {
    console.log('[SIGNAL] Disconnecting socket');
    socket.disconnect();
    socket = null;
  }
};

export const getOnlineUsers = (): OnlineUser[] => {
  return onlineUsersCache;
};

export const getIceServers = (): any[] | undefined => {
  return iceServersCache;
};

export const isUserOnline = (userId: string): boolean => {
  return onlineUsersCache.some((u) => u.userId === userId);
};

// Event registration helpers
export const onIncomingCall = (handler: (data: SignalIncomingCall) => void): void => {
  if (!socket) return;
  socket.off('incoming-call');
  socket.on('incoming-call', (data: SignalIncomingCall) => {
    console.log('[SIGNAL] incoming-call', data);
    handler(data);
  });
};

export const onCallAccepted = (handler: (data: SignalCallAccepted) => void): void => {
  if (!socket) return;
  socket.off('call-accepted');
  socket.on('call-accepted', (data: SignalCallAccepted) => {
    console.log('[SIGNAL] call-accepted', data);
    handler(data);
  });
};

export const onCallRejected = (handler: (data: SignalCallRejected) => void): void => {
  if (!socket) return;
  socket.off('call-rejected');
  socket.on('call-rejected', (data: SignalCallRejected) => {
    console.log('[SIGNAL] call-rejected', data);
    handler(data);
  });
};

export const onOffer = (handler: (data: SignalOffer) => void): void => {
  if (!socket) return;
  socket.off('offer');
  socket.on('offer', (data: SignalOffer) => {
    console.log('[SIGNAL] offer', data);
    handler(data);
  });
};

export const onAnswer = (handler: (data: SignalAnswer) => void): void => {
  if (!socket) return;
  socket.off('answer');
  socket.on('answer', (data: SignalAnswer) => {
    console.log('[SIGNAL] answer', data);
    handler(data);
  });
};

export const onIceCandidate = (handler: (data: SignalIceCandidate) => void): void => {
  if (!socket) return;
  socket.off('ice-candidate');
  socket.on('ice-candidate', (data: SignalIceCandidate) => {
    console.log('[SIGNAL] ice-candidate', data);
    handler(data);
  });
};

export const onCallEnded = (handler: (data: SignalCallEnded) => void): void => {
  if (!socket) return;
  socket.off('call-ended');
  socket.on('call-ended', (data: SignalCallEnded) => {
    console.log('[SIGNAL] call-ended', data);
    handler(data);
  });
};

export const onOnlineUsersUpdate = (handler: (users: OnlineUser[]) => void): void => {
  if (!onlineUsersListeners.includes(handler)) {
    onlineUsersListeners.push(handler);
  }
};

export const removeAllCallListeners = (): void => {
  if (!socket) return;
  socket.off('incoming-call');
  socket.off('call-accepted');
  socket.off('call-rejected');
  socket.off('offer');
  socket.off('answer');
  socket.off('ice-candidate');
  socket.off('call-ended');
  console.log('[SIGNAL] Removed all call listeners');
};

// Emit helpers
export const emitCallUser = (data: SignalCallUser): void => {
  if (!socket) return;
  console.log('[SIGNAL] emit call-user', data);
  socket.emit('call-user', data);
};

export const emitCallAccepted = (data: SignalCallAccepted): void => {
  if (!socket) return;
  console.log('[SIGNAL] emit call-accepted', data);
  socket.emit('call-accepted', data);
};

export const emitCallRejected = (data: SignalCallRejected): void => {
  if (!socket) return;
  console.log('[SIGNAL] emit call-rejected', data);
  socket.emit('call-rejected', data);
};

export const emitOffer = (data: SignalOffer & { targetId: string }): void => {
  if (!socket) return;
  console.log('[SIGNAL] emit offer', data);
  socket.emit('offer', data);
};

export const emitAnswer = (data: SignalAnswer & { targetId: string }): void => {
  if (!socket) return;
  console.log('[SIGNAL] emit answer', data);
  socket.emit('answer', data);
};

export const emitIceCandidate = (data: SignalIceCandidate & { targetId: string }): void => {
  if (!socket) return;
  console.log('[SIGNAL] emit ice-candidate', data);
  socket.emit('ice-candidate', data);
};

export const emitEndCall = (data: SignalEndCall & { targetId: string }): void => {
  if (!socket) return;
  console.log('[SIGNAL] emit end-call', data);
  socket.emit('end-call', data);
};
