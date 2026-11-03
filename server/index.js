/**
 * ClearVoice signaling backend.
 * Express serves health/config, Socket.IO carries call signaling only.
 */

import http from 'node:http';
import express from 'express';
import { Server } from 'socket.io';
import cors from 'cors';
import { registerCallHandlers } from './socket/callHandlers.js';
import { getIceServers, iceStatus, warnOnce } from './config/iceServers.js';

const PORT = Number(process.env.PORT || 3001);
const ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';
const origins = ORIGIN.split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const app = express();
app.use(cors({ origin: origins, credentials: true }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'clearvoice-signaling', uptimeSec: Math.round(process.uptime()) });
});

// Handy for manual verification that TURN wiring is picked up (credentials are masked).
app.get('/config/ice', (_req, res) => {
  const status = iceStatus();
  res.json({ ...status, urls: getIceServers().map((s) => (Array.isArray(s.urls) ? s.urls : s.urls)) });
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: origins, methods: ['GET', 'POST'], credentials: true },
  path: '/socket.io',
  pingInterval: 10000,
  pingTimeout: 20000,
});

registerCallHandlers(io);

server.listen(PORT, () => {
  console.log(`[clearvoice] signaling server listening on :${PORT}`);
  console.log(`[clearvoice] allowed origins: ${origins.join(', ')}`);
  const status = iceStatus();
  console.log(`[clearvoice] ICE: ${status.stun} | TURN configured: ${status.turnConfigured}`);
  warnOnce();
});

process.on('SIGTERM', () => {
  console.log('[clearvoice] SIGTERM, closing server');
  io.close();
  server.close(() => process.exit(0));
});
