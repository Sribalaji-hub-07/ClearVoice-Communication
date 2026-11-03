/**
 * End-to-end test of the real ClearVoice signaling server.
 *
 * Boots server/index.js as a child process, connects genuine socket.io clients and drives a
 * complete two-user call, then attacks it the way a browser extension would: an outsider
 * trying to answer somebody else's call, signaling aimed at the wrong peer, an oversized SDP,
 * a message flood. Every assertion is checked against what the server actually sent.
 *
 * Usage: node tools/signaling-test.mjs
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { io } from 'socket.io-client';

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = join(here, '..', 'server', 'index.js');
const PORT = 3123;
const URL = `http://127.0.0.1:${PORT}`;

/** Event names the protocol allows. Anything else would mean audio or stray data on the wire. */
const ALLOWED_EVENTS = new Set([
  'cv:register', 'cv:registered', 'cv:rename', 'cv:dial', 'cv:accept', 'cv:reject', 'cv:hangup',
  'cv:offer', 'cv:answer', 'cv:ice', 'cv:directory', 'cv:incoming', 'cv:dialing', 'cv:accepted',
  'cv:rejected', 'cv:ended', 'cv:offer-to', 'cv:answer-to', 'cv:ice-to', 'cv:peer-lost', 'cv:error',
]);

let passed = 0;
let failed = 0;

function check(label, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}${detail ? ` - ${detail}` : ''}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`);
  }
}

function makeClient(label) {
  const socket = io(URL, { transports: ['websocket'], forceNew: true });
  const seen = [];
  const waiters = [];
  socket.onAny((event, payload) => {
    const json = JSON.stringify(payload ?? null);
    seen.push({ event, payload, bytes: json ? json.length : 0 });
    const idx = waiters.findIndex((w) => w.event === event);
    if (idx >= 0) {
      const [w] = waiters.splice(idx, 1);
      clearTimeout(w.timer);
      w.resolve(payload);
    }
  });
  const wait = (event, timeout = 2500) =>
    new Promise((resolve, reject) => {
      const entry = { event, resolve };
      entry.timer = setTimeout(() => reject(new Error(`${label}: no ${event} within ${timeout} ms`)), timeout);
      waiters.push(entry);
    });
  const ask = (event, payload, timeout = 2500) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label}: ${event} ack timeout`)), timeout);
      socket.emit(event, payload, (reply) => {
        clearTimeout(timer);
        resolve(reply);
      });
    });
  /** Only cv:register answers with an ack; every other event is fire-and-forget. */
  const push = (event, payload) => socket.emit(event, payload);
  return { socket, seen, wait, ask, push, label };
}

async function waitForHealth(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${URL}/health`);
      if (res.ok) return await res.json();
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Signaling server never became healthy.');
}

function connected(client) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${client.label}: connect timeout`)), 8000);
    client.socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

const FD_LDP = 'v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';

const server = spawn(process.execPath, [serverEntry], {
  env: { ...process.env, PORT: String(PORT), CORS_ORIGIN: 'http://localhost:5173' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d.toString()));
server.stderr.on('data', (d) => (serverLog += d.toString()));

const clients = [];
try {
  const health = await waitForHealth();
  console.log('\n[1] HTTP surface');
  check('GET /health reports the service', health.ok === true && health.service === 'clearvoice-signaling');

  const ice = await fetch(`${URL}/config/ice`).then((r) => r.json());
  const leaked = JSON.stringify(ice).match(/(username|credential|password)\s*:\s*"(?!\s*")/i);
  check('GET /config/ice never exposes TURN credentials', !leaked, `payload ${JSON.stringify(ice).slice(0, 140)}`);

  const [a, b, c] = ['caller', 'callee', 'outsider'].map((l) => {
    const client = makeClient(l);
    clients.push(client);
    return client;
  });
  await Promise.all([a, b, c].map((x) => connected(x)));

  console.log('\n[2] registration and presence');
  const regA = await a.ask('cv:register', { name: 'Rider A' });
  const regB = await b.ask('cv:register', { name: 'Rider B' });
  const regC = await c.ask('cv:register', { name: 'Spy' });
  check('each client gets a unique short id', !!regA.userId && !!regB.userId && regA.userId !== regB.userId, `${regA.userId} / ${regB.userId} / ${regC.userId}`);
  check('registration returns the ICE configuration', Array.isArray(regA.iceServers));
  check('directory lists the online users', regB.directory.some((u) => u.id === regA.userId) && regB.directory.some((u) => u.id === regB.userId));

  const hijack = makeClient('hijacker');
  clients.push(hijack);
  await connected(hijack);
  await hijack.ask('cv:register', { name: 'H' });
  const stolen = await hijack.ask('cv:register', { id: regC.userId, name: 'Hijack' });
  check('a taken id cannot be claimed by someone else', stolen.userId !== regC.userId, `got ${stolen.userId}`);
  hijack.socket.close();

  // A reload reuses the connection; the identity it abandoned must stop receiving signalling.
  const reloader = makeClient('reloader');
  clients.push(reloader);
  await connected(reloader);
  const firstId = (await reloader.ask('cv:register', { name: 'Before reload' })).userId;
  const second = await reloader.ask('cv:register', { name: 'After reload' });
  check(
    'a reload does not leave the abandoned id in the directory',
    !second.directory.some((u) => u.id === firstId) && second.directory.some((u) => u.id === second.userId),
    `${firstId} -> ${second.userId}`,
  );
  reloader.socket.close();

  console.log('\n[3] call setup with authorisation checks');
  const incomingPromise = b.wait('cv:incoming');
  a.push('cv:dial', { to: regB.userId });
  const incoming = await incomingPromise;
  check('callee receives the incoming call', incoming.from === regA.userId && !!incoming.callId);

  b.push('cv:dial', { to: regB.userId });
  const selfErr = await b.wait('cv:error').catch(() => null);
  check('a user cannot call themselves', selfErr && selfErr.code === 'self-call', selfErr ? selfErr.code : 'no error');

  b.push('cv:dial', { to: 'Q7KZ' });
  const ghostErr = await b.wait('cv:error').catch(() => null);
  check('dialling an offline id is refused', ghostErr && ghostErr.code === 'offline', ghostErr ? ghostErr.code : 'no error');

  c.push('cv:accept', { callId: incoming.callId });
  const outsiderErr = await c.wait('cv:error', 1500).catch(() => null);
  check("an outsider cannot answer someone else's call", outsiderErr && outsiderErr.code === 'forbidden', outsiderErr ? outsiderErr.code : 'no error');

  c.push('cv:accept', { callId: 'does-not-exist' });
  const bogusErr = await c.wait('cv:error', 1500).catch(() => null);
  check('an unknown call id is refused', bogusErr && bogusErr.code === 'no-call', bogusErr ? bogusErr.code : 'no error');

  console.log('\n[4] SDP and ICE relay inside the call');
  const acceptedPromise = a.wait('cv:accepted');
  b.push('cv:accept', { callId: incoming.callId });
  const accepted = await acceptedPromise;
  check('caller is told the call was accepted', accepted.from === regB.userId);

  const offerPromise = b.wait('cv:offer-to');
  a.push('cv:offer', { callId: incoming.callId, to: regB.userId, sdp: FD_LDP });
  const offer = await offerPromise;
  check('offer reaches the peer intact', offer.sdp === FD_LDP && offer.from === regA.userId);

  const icePromise = b.wait('cv:ice-to');
  const candidate = { candidate: 'candidate:1 1 udp 2122260223 192.168.1.20 54321 typ host', sdpMid: '0', sdpMLineIndex: 0 };
  a.push('cv:ice', { callId: incoming.callId, to: regB.userId, candidate });
  const relayed = await icePromise;
  check('ICE candidate is relayed to the peer', JSON.stringify(relayed.candidate) === JSON.stringify(candidate));

  const endPromise = b.wait('cv:ice-to');
  a.push('cv:ice', { callId: incoming.callId, to: regB.userId, candidate: null });
  const endRelay = await endPromise;
  check('the end-of-candidates marker passes through as null', endRelay.candidate === null);

  a.push('cv:ice', { callId: incoming.callId, to: regB.userId, candidate: 42 });
  const badIce = await a.wait('cv:error').catch(() => null);
  check('a malformed ICE candidate is rejected', badIce && badIce.code === 'bad-payload', badIce ? badIce.code : 'no error');

  c.push('cv:offer', { callId: incoming.callId, to: regB.userId, sdp: FD_LDP });
  const wrongResult = await c.wait('cv:error').catch(() => null);
  check('a non-participant cannot inject an offer', wrongResult && wrongResult.code === 'forbidden', wrongResult ? wrongResult.code : 'no error');

  a.push('cv:offer', { callId: incoming.callId, to: regC.userId, sdp: FD_LDP });
  const spoofResult = await a.wait('cv:error').catch(() => null);
  check('signaling aimed at a third id is refused', spoofResult && spoofResult.code === 'forbidden', spoofResult ? spoofResult.code : 'no error');

  const huge = `v=0\r\n${'x'.repeat(20001)}`;
  a.push('cv:offer', { callId: incoming.callId, to: regB.userId, sdp: huge });
  const oversizeResult = await a.wait('cv:error').catch(() => null);
  check('an oversized SDP payload is rejected', oversizeResult && oversizeResult.code === 'bad-payload', oversizeResult ? oversizeResult.code : 'no error');

  const answerPromise = a.wait('cv:answer-to');
  b.push('cv:answer', { callId: incoming.callId, to: regA.userId, sdp: FD_LDP });
  const answer = await answerPromise;
  check('answer returns to the caller', answer.sdp === FD_LDP && answer.from === regB.userId);

  console.log('\n[5] teardown');
  const endedA = a.wait('cv:ended');
  const endedB = b.wait('cv:ended');
  a.push('cv:hangup', { callId: incoming.callId });
  const [endA, endB] = await Promise.all([endedA, endedB]);
  check('hangup ends the call for both sides', endA.code === 'hangup' && endB.code === 'hangup');

  c.push('cv:hangup', { callId: incoming.callId });
  const strangerResult = await c.wait('cv:error').catch(() => null);
  check('after teardown an outsider cannot hang up', strangerResult && strangerResult.code === 'no-call', strangerResult ? strangerResult.code : 'no error');

  console.log('\n[6] disconnect recovery and abuse limits');
  const y = makeClient('leaver');
  clients.push(y);
  await connected(y);
  const yReg = await y.ask('cv:register', { name: 'Leaver' });
  const xIncoming = y.wait('cv:incoming');
  a.push('cv:dial', { to: yReg.userId });
  const xCall = await xIncoming;
  const lost = a.wait('cv:peer-lost');
  y.socket.close();
  const lostPayload = await lost;
  check('a dropped peer tells the other side', lostPayload.callId === xCall.callId && lostPayload.code === 'peer-disconnected');

  const floodErr = b.wait('cv:error');
  for (let i = 0; i < 80; i++) b.socket.emit('cv:rename', { name: `Flood ${i}` });
  const flood = await floodErr.catch(() => null);
  check('a signaling flood is rate limited', flood && flood.code === 'rate-limited', flood ? flood.code : 'never throttled');

  console.log('\n[7] wire discipline');
  const all = clients.flatMap((cl) => cl.seen.map((s) => s.event));
  const unexpected = [...new Set(all.filter((e) => !ALLOWED_EVENTS.has(e)))];
  check('only signaling events appear on the wire', unexpected.length === 0, unexpected.join(', ') || `${all.length} messages`);
  const biggest = Math.max(0, ...clients.flatMap((cl) => cl.seen.map((s) => s.bytes)));
  check('no message is large enough to carry audio', biggest < 20000, `largest frame ${biggest} bytes`);
} catch (err) {
  failed++;
  console.log(`\n  FAIL  harness error - ${err && err.message}`);
  console.log(serverLog);
} finally {
  for (const cl of clients) {
    try {
      cl.socket.close();
    } catch {
      /* already gone */
    }
  }
  server.kill('SIGTERM');
}

console.log(`\n${failed === 0 ? 'ALL SIGNALING CHECKS PASSED' : `${failed} SIGNALING CHECK(S) FAILED`} (${passed} passed)`);
process.exit(failed === 0 ? 0 : 1);
