import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Body parsing
app.use(express.json());

// Allow CORS for dev, but in production (Railway/Render), they will be on the same domain
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// User Storage & Persistence
interface UserRecord {
  username: string;
  displayName: string;
  passwordHash: string;
  createdAt: number;
}

const USERS_FILE = path.join(__dirname, 'users.json');
const usersMap = new Map<string, UserRecord>();

function loadUsers(): void {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const data = fs.readFileSync(USERS_FILE, 'utf-8');
      const list: UserRecord[] = JSON.parse(data);
      list.forEach((u) => usersMap.set(u.username.toLowerCase(), u));
      console.log(`[SERVER] Loaded ${usersMap.size} registered users from disk.`);
    }
  } catch (err) {
    console.error('[SERVER] Failed to load users file:', err);
  }
}

function saveUsers(): void {
  try {
    const list = Array.from(usersMap.values());
    fs.writeFileSync(USERS_FILE, JSON.stringify(list, null, 2), 'utf-8');
  } catch (err) {
    console.error('[SERVER] Failed to save users file:', err);
  }
}

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password.trim()).digest('hex');
}

loadUsers();

// Auth Endpoints: Username + Password (No Gmail, No OTP)
app.post('/api/auth/signup', (req, res) => {
  const { username, password, displayName } = req.body || {};
  const cleanUsername = String(username || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');

  if (!cleanUsername || cleanUsername.length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 alphanumeric characters (a-z, 0-9, _).' });
  }

  if (!password || String(password).length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters.' });
  }

  if (usersMap.has(cleanUsername)) {
    return res.status(400).json({ error: `Username "${cleanUsername}" is already taken. Please choose another.` });
  }

  const cleanDisplayName = String(displayName || cleanUsername).trim();
  const newUser: UserRecord = {
    username: cleanUsername,
    displayName: cleanDisplayName,
    passwordHash: hashPassword(password),
    createdAt: Date.now(),
  };

  usersMap.set(cleanUsername, newUser);
  saveUsers();
  console.log(`[AUTH] New user registered: ${cleanDisplayName} (@${cleanUsername})`);

  return res.json({
    user: {
      id: cleanUsername,
      username: cleanUsername,
      name: cleanDisplayName,
      createdAt: newUser.createdAt,
    },
  });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const cleanUsername = String(username || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');

  if (!cleanUsername || !password) {
    return res.status(400).json({ error: 'Please enter your username and password.' });
  }

  const existing = usersMap.get(cleanUsername);
  if (!existing || existing.passwordHash !== hashPassword(password)) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  console.log(`[AUTH] User signed in: ${existing.displayName} (@${existing.username})`);
  return res.json({
    user: {
      id: existing.username,
      username: existing.username,
      name: existing.displayName,
      createdAt: existing.createdAt,
    },
  });
});

// User Directory Endpoint
app.get('/api/users', (req, res) => {
  const onlineSet = new Set(
    Array.from(onlineUsers.values()).map((u) => u.userId.toLowerCase())
  );

  const directory = Array.from(usersMap.values()).map((u) => ({
    id: u.username,
    username: u.username,
    name: u.displayName,
    isOnline: onlineSet.has(u.username.toLowerCase()),
    createdAt: u.createdAt,
  }));

  return res.json(directory);
});

// Serve static frontend files from Vite 'dist'
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

function findTargetSockets(target: string): string[] {
  const clean = String(target).trim().replace(/^#/, '').toLowerCase();
  const socketIds = new Set<string>();

  for (const [socketId, user] of onlineUsers.entries()) {
    if (user.userId.toLowerCase() === clean || user.userName.toLowerCase() === clean) {
      socketIds.add(socketId);
    }
  }
  return Array.from(socketIds);
}

function resolveTargetRooms(target: string): string[] {
  const clean = String(target).trim().replace(/^#/, '').toLowerCase();
  const rooms = new Set<string>();
  rooms.add(`uid_${clean}`);
  rooms.add(`uname_${clean}`);

  for (const user of onlineUsers.values()) {
    if (user.userId.toLowerCase() === clean || user.userName.toLowerCase() === clean) {
      rooms.add(`uid_${user.userId}`);
      rooms.add(`uname_${user.userName.toLowerCase()}`);
    }
  }
  return Array.from(rooms);
}

function emitToTarget(target: string, event: string, payload: any): boolean {
  const socketIds = findTargetSockets(target);
  const rooms = resolveTargetRooms(target);

  if (socketIds.length === 0 && rooms.length === 0) {
    return false;
  }

  for (const sid of socketIds) {
    io.to(sid).emit(event, payload);
  }
  for (const room of rooms) {
    io.to(room).emit(event, payload);
  }
  return true;
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

  // Purge any stale/older sockets for this same userId to prevent routing to dead sockets
  for (const [sId, u] of onlineUsers.entries()) {
    if (u.userId === userId && sId !== socket.id) {
      console.log(`[SERVER] Cleaning up stale socket ${sId} for user ${userId}`);
      onlineUsers.delete(sId);
    }
  }

  console.log(`[SERVER] User connected: ${userName} (${userId}) on socket ${socket.id}`);
  
  onlineUsers.set(socket.id, { userId, userName });

  // Join persistent room channels for resilient multi-device / multi-tab routing
  socket.join(`uid_${userId}`);
  socket.join(`uname_${userName.trim().toLowerCase()}`);

  socket.broadcast.emit('user-online', { userId, userName, socketId: socket.id });
  socket.emit('online-users', getUniqueOnlineUsers());

  socket.on('get-online-users', () => {
    socket.emit('online-users', getUniqueOnlineUsers());
  });

  socket.on('get-ice-servers', () => {
    const iceServers: any[] = [
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
    const rawReceiver = String(data.receiverId).trim();
    const cleanReceiver = rawReceiver.replace(/^#/, '');
    const cleanCallerId = String(data.callerId).trim().replace(/^#/, '');
    console.log(`[SIGNAL] call-user: ${data.callerName} (${cleanCallerId}) calling target: ${cleanReceiver}`);

    const targetSockets = findTargetSockets(cleanReceiver);
    if (targetSockets.length === 0) {
      console.log(`[SIGNAL] call-error: Receiver #${cleanReceiver} is offline. Online list:`, Array.from(onlineUsers.values()));
      socket.emit('call-error', { message: `User #${cleanReceiver} is currently offline.` });
      return;
    }

    activeCalls.set(data.callId, { callerId: cleanCallerId, receiverId: cleanReceiver });

    console.log(`[SIGNAL] Routing incoming-call to target ${cleanReceiver} (sockets: ${targetSockets.join(', ')})`);
    emitToTarget(cleanReceiver, 'incoming-call', {
      callId: data.callId,
      callerId: cleanCallerId,
      callerName: data.callerName
    });
  });

  socket.on('call-accepted', (data: { callId: string; callerId: string; receiverId: string; receiverName: string }) => {
    console.log(`[SIGNAL] call-accepted: ${data.receiverName} accepted call from ${data.callerId}`);
    emitToTarget(data.callerId, 'call-accepted', data);
  });

  socket.on('call-rejected', (data: { callId: string; callerId?: string; receiverId: string; reason?: string }) => {
    console.log(`[SIGNAL] call-rejected: Call ${data.callId} rejected by ${data.receiverId}`);
    const callRecord = activeCalls.get(data.callId);
    const callerId = data.callerId || callRecord?.callerId;
    if (callerId) {
      emitToTarget(callerId, 'call-rejected', data);
    }
    activeCalls.delete(data.callId);
  });

  socket.on('offer', (data: { callId: string; targetId: string; fromUserId: string; offer: any }) => {
    console.log(`[SIGNAL] offer: from ${data.fromUserId} to ${data.targetId}`);
    emitToTarget(data.targetId, 'offer', data);
  });

  socket.on('answer', (data: { callId: string; targetId: string; fromUserId: string; answer: any }) => {
    console.log(`[SIGNAL] answer: from ${data.fromUserId} to ${data.targetId}`);
    emitToTarget(data.targetId, 'answer', data);
  });

  socket.on('ice-candidate', (data: { callId: string; targetId: string; fromUserId: string; candidate: any }) => {
    console.log(`[SIGNAL] ice-candidate: from ${data.fromUserId} to ${data.targetId}`);
    emitToTarget(data.targetId, 'ice-candidate', data);
  });

  socket.on('end-call', (data: { callId: string; fromUserId: string; targetId: string; reason?: string }) => {
    console.log(`[SIGNAL] end-call: Call ${data.callId} ended by ${data.fromUserId}`);
    emitToTarget(data.targetId, 'call-ended', { callId: data.callId, reason: data.reason });
    activeCalls.delete(data.callId);
  });

  // Direct Chat Message Relay (Real-time WebSocket)
  socket.on('send-chat-message', (data: { id: string; senderId: string; senderName: string; receiverId: string; text: string; timestamp: number }) => {
    console.log(`[CHAT] Message from ${data.senderName} (${data.senderId}) to ${data.receiverId}`);
    emitToTarget(data.receiverId, 'receive-chat-message', data);
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
        emitToTarget(otherPartyId, 'call-ended', { callId, reason: 'user-disconnected' });
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
