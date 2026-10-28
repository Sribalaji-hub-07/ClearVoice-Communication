import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Allow CORS for dev, but in production (Railway), they will be on the same domain
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Serve static frontend files from the Vite 'dist' folder
app.use(express.static(path.join(__dirname, '../dist')));

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: ['http://localhost:5173', '*'],
    methods: ['GET', 'POST']
  }
});

// Map<socketId, {userId, userName}>
const onlineUsers = new Map<string, { userId: string; userName: string }>();

// Map<callId, {callerId, receiverId}>
const activeCalls = new Map<string, { callerId: string; receiverId: string }>();

function findSocketIdByUserId(userId: string): string | undefined {
  const normalized = String(userId).trim().replace(/^#/, '');
  for (const [socketId, user] of onlineUsers.entries()) {
    if (user.userId === normalized || user.userId === userId) {
      return socketId;
    }
  }
  return undefined;
}

function getUniqueOnlineUsers() {
  const seen = new Set<string>();
  const list: { userId: string; userName: string; socketId: string }[] = [];
  for (const [socketId, user] of onlineUsers.entries()) {
    if (!seen.has(user.userId)) {
      seen.add(user.userId);
      list.push({ userId: user.userId, userName: user.userName, socketId });
    }
  }
  return list;
}

io.on('connection', (socket) => {
  const rawUserId = socket.handshake.auth.userId as string;
  const userName = socket.handshake.auth.userName as string;
  const userId = rawUserId ? String(rawUserId).trim().replace(/^#/, '') : '';

  if (!userId || !userName) {
    console.log(`[SERVER] Connection rejected: Missing userId or userName on socket ${socket.id}`);
    socket.disconnect();
    return;
  }

  console.log(`[SERVER] User connected: ${userName} (${userId}) on socket ${socket.id}`);
  
  onlineUsers.set(socket.id, { userId, userName });

  socket.broadcast.emit('user-online', { userId, userName, socketId: socket.id });

  socket.emit('online-users', getUniqueOnlineUsers());

  socket.on('get-online-users', () => {
    socket.emit('online-users', getUniqueOnlineUsers());
  });

  socket.on('get-ice-servers', () => {
    const iceServers: any[] = [
      { urls: 'stun:stun.l.google.com:19302' }
    ];

    if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
      iceServers.push({
        urls: process.env.TURN_URL,
        username: process.env.TURN_USERNAME,
        credential: process.env.TURN_CREDENTIAL
      });
    }

    socket.emit('ice-servers', iceServers);
  });

  socket.on('call-user', (data: { callId: string; callerId: string; callerName: string; receiverId: string }) => {
    const targetReceiverId = String(data.receiverId).trim().replace(/^#/, '');
    console.log(`[SIGNAL] call-user: ${data.callerName} calling target: ${targetReceiverId}`);
    const receiverSocketId = findSocketIdByUserId(targetReceiverId);

    if (!receiverSocketId) {
      console.log(`[SIGNAL] call-error: Receiver #${targetReceiverId} is offline`);
      socket.emit('call-error', { message: `User #${targetReceiverId} is currently offline.` });
      return;
    }

    activeCalls.set(data.callId, { callerId: data.callerId, receiverId: targetReceiverId });

    io.to(receiverSocketId).emit('incoming-call', {
      callId: data.callId,
      callerId: data.callerId,
      callerName: data.callerName
    });
  });

  socket.on('call-accepted', (data: { callId: string; callerId: string; receiverId: string; receiverName: string }) => {
    console.log(`[SIGNAL] call-accepted: ${data.receiverName} accepted call from ${data.callerId}`);
    const callerSocketId = findSocketIdByUserId(data.callerId);
    if (callerSocketId) {
      io.to(callerSocketId).emit('call-accepted', data);
    }
  });

  socket.on('call-rejected', (data: { callId: string; callerId?: string; receiverId: string; reason?: string }) => {
    console.log(`[SIGNAL] call-rejected: Call ${data.callId} rejected by ${data.receiverId}`);
    // callerId may not be in payload; look it up from activeCalls
    const callRecord = activeCalls.get(data.callId);
    const callerId = data.callerId || callRecord?.callerId;
    if (callerId) {
      const callerSocketId = findSocketIdByUserId(callerId);
      if (callerSocketId) {
        io.to(callerSocketId).emit('call-rejected', data);
      }
    }
    activeCalls.delete(data.callId);
  });

  socket.on('offer', (data: { callId: string; targetId: string; fromUserId: string; offer: any }) => {
    console.log(`[SIGNAL] offer: from ${data.fromUserId} to ${data.targetId}`);
    const targetSocketId = findSocketIdByUserId(data.targetId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('offer', data);
    }
  });

  socket.on('answer', (data: { callId: string; targetId: string; fromUserId: string; answer: any }) => {
    console.log(`[SIGNAL] answer: from ${data.fromUserId} to ${data.targetId}`);
    const targetSocketId = findSocketIdByUserId(data.targetId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('answer', data);
    }
  });

  socket.on('ice-candidate', (data: { callId: string; targetId: string; fromUserId: string; candidate: any }) => {
    console.log(`[SIGNAL] ice-candidate: from ${data.fromUserId} to ${data.targetId}`);
    const targetSocketId = findSocketIdByUserId(data.targetId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('ice-candidate', data);
    }
  });

  socket.on('end-call', (data: { callId: string; fromUserId: string; targetId: string; reason?: string }) => {
    console.log(`[SIGNAL] end-call: Call ${data.callId} ended by ${data.fromUserId}`);
    const targetSocketId = findSocketIdByUserId(data.targetId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('call-ended', { callId: data.callId, reason: data.reason });
    }
    activeCalls.delete(data.callId);
  });

  socket.on('disconnect', () => {
    console.log(`[SERVER] User disconnected: ${userName} (${userId}) on socket ${socket.id}`);
    onlineUsers.delete(socket.id);
    
    // Only broadcast user-offline if the user has no other active connections
    const isStillConnected = Array.from(onlineUsers.values()).some((u) => u.userId === userId);
    if (!isStillConnected) {
      socket.broadcast.emit('user-offline', userId);
    }

    for (const [callId, call] of activeCalls.entries()) {
      if (call.callerId === userId || call.receiverId === userId) {
        const otherPartyId = call.callerId === userId ? call.receiverId : call.callerId;
        const otherPartySocketId = findSocketIdByUserId(otherPartyId);
        if (otherPartySocketId) {
          io.to(otherPartySocketId).emit('call-ended', { callId, reason: 'user-disconnected' });
        }
        activeCalls.delete(callId);
      }
    }
  });
});

// Catch-all route for SPA navigation (must be after API/socket logic)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

httpServer.listen(PORT, () => {
  console.log(`[SERVER] Signaling server running on port ${PORT}`);
});
