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

export interface SocketChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  receiverId: string;
  text: string;
  timestamp: number;
}
let chatMessageListeners: ((msg: SocketChatMessage) => void)[] = [];

const notifyOnlineUsersUpdate = () => {
  onlineUsersListeners.forEach((handler) => handler(onlineUsersCache));
};

// Event handler registry so listeners are NEVER lost if registered before socket connection
interface SignalHandlers {
  incomingCall?: (data: SignalIncomingCall) => void;
  callAccepted?: (data: SignalCallAccepted) => void;
  callRejected?: (data: SignalCallRejected) => void;
  offer?: (data: SignalOffer) => void;
  answer?: (data: SignalAnswer) => void;
  iceCandidate?: (data: SignalIceCandidate) => void;
  callEnded?: (data: SignalCallEnded) => void;
  callError?: (data: { message: string }) => void;
}

const handlers: SignalHandlers = {};

function attachAllHandlers(s: Socket) {
  if (handlers.incomingCall) {
    s.off('incoming-call');
    s.on('incoming-call', handlers.incomingCall);
  }
  if (handlers.callAccepted) {
    s.off('call-accepted');
    s.on('call-accepted', handlers.callAccepted);
  }
  if (handlers.callRejected) {
    s.off('call-rejected');
    s.on('call-rejected', handlers.callRejected);
  }
  if (handlers.offer) {
    s.off('offer');
    s.on('offer', handlers.offer);
  }
  if (handlers.answer) {
    s.off('answer');
    s.on('answer', handlers.answer);
  }
  if (handlers.iceCandidate) {
    s.off('ice-candidate');
    s.on('ice-candidate', handlers.iceCandidate);
  }
  if (handlers.callEnded) {
    s.off('call-ended');
    s.on('call-ended', handlers.callEnded);
  }
  if (handlers.callError) {
    s.off('call-error');
    s.on('call-error', handlers.callError);
  }
}

export const getSocket = (): Socket | null => {
  return socket;
};

export const connectSocket = (userId: string, userName: string): Socket => {
  if (socket) {
    if (socket.connected) {
      console.log('[SIGNAL] Socket already connected');
      attachAllHandlers(socket);
      return socket;
    }
    socket.disconnect();
  }

  const isProd = import.meta.env.PROD;
  // Fallback to hostname:3001 in dev so LAN devices (phones) connect to the host PC's server
  const url = import.meta.env.VITE_SIGNALING_URL || (isProd ? window.location.origin : `http://${window.location.hostname}:3001`);
  console.log(`[SIGNAL] Connecting to signaling server at ${url}`);

  const cleanUserId = String(userId).trim().replace(/^#/, '');

  socket = io(url, {
    auth: { userId: cleanUserId, userName },
  });

  attachAllHandlers(socket);

  socket.on('connect', () => {
    console.log('[SIGNAL] Socket connected:', socket?.id);
    if (socket) attachAllHandlers(socket);
    socket?.emit('get-online-users');
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

  socket.on('user-offline', (data: string | { userId: string }) => {
    const offlineId = typeof data === 'string' ? data : data?.userId;
    console.log('[SIGNAL] User offline:', offlineId);
    onlineUsersCache = onlineUsersCache.filter((u) => u.userId !== offlineId);
    notifyOnlineUsersUpdate();
  });

  socket.on('receive-chat-message', (msg: SocketChatMessage) => {
    console.log('[SIGNAL] Received chat message from', msg.senderId);
    chatMessageListeners.forEach((fn) => {
      try {
        fn(msg);
      } catch (err) {
        console.error('Error in chat message listener:', err);
      }
    });
  });

  return socket;
};

export const onReceiveChatMessage = (listener: (msg: SocketChatMessage) => void): (() => void) => {
  chatMessageListeners.push(listener);
  return () => {
    chatMessageListeners = chatMessageListeners.filter((l) => l !== listener);
  };
};

export const emitSendChatMessage = (msg: SocketChatMessage): void => {
  if (!socket) return;
  console.log('[SIGNAL] Emitting send-chat-message to', msg.receiverId);
  socket.emit('send-chat-message', msg);
};

export const requestOnlineUsers = (): void => {
  if (socket && socket.connected) {
    socket.emit('get-online-users');
  }
};

export const onCallError = (handler: (data: { message: string }) => void): void => {
  handlers.callError = handler;
  if (socket) {
    socket.off('call-error');
    socket.on('call-error', (data: { message: string }) => {
      console.log('[SIGNAL] call-error', data);
      handler(data);
    });
  }
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
  const cleanId = String(userId).trim().replace(/^#/, '');
  return onlineUsersCache.some((u) => u.userId === cleanId || u.userId === userId);
};

// Event registration helpers
export const onIncomingCall = (handler: (data: SignalIncomingCall) => void): void => {
  handlers.incomingCall = handler;
  if (socket) {
    socket.off('incoming-call');
    socket.on('incoming-call', (data: SignalIncomingCall) => {
      console.log('[SIGNAL] incoming-call', data);
      handler(data);
    });
  }
};

export const onCallAccepted = (handler: (data: SignalCallAccepted) => void): void => {
  handlers.callAccepted = handler;
  if (socket) {
    socket.off('call-accepted');
    socket.on('call-accepted', (data: SignalCallAccepted) => {
      console.log('[SIGNAL] call-accepted', data);
      handler(data);
    });
  }
};

export const onCallRejected = (handler: (data: SignalCallRejected) => void): void => {
  handlers.callRejected = handler;
  if (socket) {
    socket.off('call-rejected');
    socket.on('call-rejected', (data: SignalCallRejected) => {
      console.log('[SIGNAL] call-rejected', data);
      handler(data);
    });
  }
};

export const onOffer = (handler: (data: SignalOffer) => void): void => {
  handlers.offer = handler;
  if (socket) {
    socket.off('offer');
    socket.on('offer', (data: SignalOffer) => {
      console.log('[SIGNAL] offer', data);
      handler(data);
    });
  }
};

export const onAnswer = (handler: (data: SignalAnswer) => void): void => {
  handlers.answer = handler;
  if (socket) {
    socket.off('answer');
    socket.on('answer', (data: SignalAnswer) => {
      console.log('[SIGNAL] answer', data);
      handler(data);
    });
  }
};

export const onIceCandidate = (handler: (data: SignalIceCandidate) => void): void => {
  handlers.iceCandidate = handler;
  if (socket) {
    socket.off('ice-candidate');
    socket.on('ice-candidate', (data: SignalIceCandidate) => {
      console.log('[SIGNAL] ice-candidate', data);
      handler(data);
    });
  }
};

export const onCallEnded = (handler: (data: SignalCallEnded) => void): void => {
  handlers.callEnded = handler;
  if (socket) {
    socket.off('call-ended');
    socket.on('call-ended', (data: SignalCallEnded) => {
      console.log('[SIGNAL] call-ended', data);
      handler(data);
    });
  }
};

export const onOnlineUsersUpdate = (handler: (users: OnlineUser[]) => void): void => {
  if (!onlineUsersListeners.includes(handler)) {
    onlineUsersListeners.push(handler);
  }
};

export const removeAllCallListeners = (): void => {
  delete handlers.incomingCall;
  delete handlers.callAccepted;
  delete handlers.callRejected;
  delete handlers.offer;
  delete handlers.answer;
  delete handlers.iceCandidate;
  delete handlers.callEnded;
  delete handlers.callError;
  if (!socket) return;
  socket.off('incoming-call');
  socket.off('call-accepted');
  socket.off('call-rejected');
  socket.off('offer');
  socket.off('answer');
  socket.off('ice-candidate');
  socket.off('call-ended');
  socket.off('call-error');
  console.log('[SIGNAL] Removed all call listeners');
};

// Emit helpers with ID sanitization
export const emitCallUser = (data: SignalCallUser): void => {
  if (!socket) return;
  const sanitized = {
    ...data,
    callerId: String(data.callerId).trim().replace(/^#/, ''),
    receiverId: String(data.receiverId).trim().replace(/^#/, ''),
  };
  console.log('[SIGNAL] emit call-user', sanitized);
  socket.emit('call-user', sanitized);
};

export const emitCallAccepted = (data: SignalCallAccepted): void => {
  if (!socket) return;
  const sanitized = {
    ...data,
    callerId: String(data.callerId).trim().replace(/^#/, ''),
    receiverId: String(data.receiverId).trim().replace(/^#/, ''),
  };
  console.log('[SIGNAL] emit call-accepted', sanitized);
  socket.emit('call-accepted', sanitized);
};

export const emitCallRejected = (data: SignalCallRejected): void => {
  if (!socket) return;
  const sanitized: SignalCallRejected = {
    callId: data.callId,
    receiverId: String(data.receiverId).trim().replace(/^#/, ''),
    reason: data.reason,
  };
  console.log('[SIGNAL] emit call-rejected', sanitized);
  socket.emit('call-rejected', sanitized);
};

export const emitOffer = (data: SignalOffer & { targetId: string }): void => {
  if (!socket) return;
  const sanitized = {
    ...data,
    fromUserId: String(data.fromUserId).trim().replace(/^#/, ''),
    targetId: String(data.targetId).trim().replace(/^#/, ''),
  };
  console.log('[SIGNAL] emit offer', sanitized);
  socket.emit('offer', sanitized);
};

export const emitAnswer = (data: SignalAnswer & { targetId: string }): void => {
  if (!socket) return;
  const sanitized = {
    ...data,
    fromUserId: String(data.fromUserId).trim().replace(/^#/, ''),
    targetId: String(data.targetId).trim().replace(/^#/, ''),
  };
  console.log('[SIGNAL] emit answer', sanitized);
  socket.emit('answer', sanitized);
};

export const emitIceCandidate = (data: SignalIceCandidate & { targetId: string }): void => {
  if (!socket) return;
  const sanitized = {
    ...data,
    fromUserId: String(data.fromUserId).trim().replace(/^#/, ''),
    targetId: String(data.targetId).trim().replace(/^#/, ''),
  };
  console.log('[SIGNAL] emit ice-candidate', sanitized);
  socket.emit('ice-candidate', sanitized);
};

export const emitEndCall = (data: SignalEndCall & { targetId: string }): void => {
  if (!socket) return;
  const sanitized = {
    ...data,
    fromUserId: String(data.fromUserId).trim().replace(/^#/, ''),
    targetId: String(data.targetId).trim().replace(/^#/, ''),
  };
  console.log('[SIGNAL] emit end-call', sanitized);
  socket.emit('end-call', sanitized);
};
