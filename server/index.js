/**
 * ClearVoice signaling backend.
 * Express serves health/config, Socket.IO carries call signaling only.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

/**
 * Render and Railway can host the whole app as one service: the Vite bundle sits in
 * ../dist and this process serves it, so the SPA and /socket.io are same-origin and
 * the client needs no VITE_SIGNALING_URL at all.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.resolve(process.env.STATIC_DIR || path.join(here, '..', 'dist'));
const servingStatic = fs.existsSync(path.join(staticDir, 'index.html'));

const app = express();
app.use(cors({ origin: origins, credentials: true }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// Self-destroying service worker endpoint to decommission any legacy PWA
app.get(['/sw.js', '/registerSW.js', '/workbox-*.js'], (_req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(`
    self.addEventListener('install', () => self.skipWaiting());
    self.addEventListener('activate', (e) => {
      e.waitUntil(
        caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
          .then(() => self.registration.unregister())
          .then(() => self.clients.claim())
          .then(() => self.clients.matchAll({ type: 'window' }))
          .then((clients) => {
            clients.forEach((c) => c.navigate(c.url));
          })
      );
    });
  `);
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'clearvoice-signaling', uptimeSec: Math.round(process.uptime()) });
});

// Handy for manual verification that TURN wiring is picked up (credentials are masked).
app.get('/config/ice', (_req, res) => {
  const status = iceStatus();
  res.json({ ...status, urls: getIceServers().map((s) => (Array.isArray(s.urls) ? s.urls : s.urls)) });
});

const API_PATH = /^\/(socket\.io|health|config\/ice|sw\.js|registerSW\.js)(\/|$)/;

if (servingStatic) {
  app.use(
    express.static(staticDir, {
      index: false,
      setHeaders: (res, filePath) => {
        res.setHeader('Cache-Control', filePath.endsWith('index.html') ? 'no-cache, no-store, must-revalidate' : 'public, max-age=3600');
      },
    }),
  );
  // The UI is a single page with in-app tabs, so any other GET returns the shell.
  app.get('/', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(staticDir, 'index.html'));
  });
  app.use((req, res, next) => {
    if (req.method !== 'GET' || API_PATH.test(req.path)) return next();
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(staticDir, 'index.html'), (err) => (err ? next(err) : undefined));
  });
}

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
  console.log(
    servingStatic
      ? `[clearvoice] serving the built frontend from ${staticDir}`
      : `[clearvoice] no frontend in ${staticDir} - signaling only (run npm run build first, or set STATIC_DIR)`,
  );
  const status = iceStatus();
  console.log(`[clearvoice] ICE: ${status.stun} | TURN configured: ${status.turnConfigured}`);
  warnOnce();
});

process.on('SIGTERM', () => {
  console.log('[clearvoice] SIGTERM, closing server');
  io.close();
  server.close(() => process.exit(0));
});
