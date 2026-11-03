/**
 * Socket.IO call signaling.
 *
 * The server only routes signaling payloads (SDP, ICE, call events). Audio never
 * passes through here - it flows peer-to-peer over RTCPeerConnection.
 */

import { randomUUID } from 'node:crypto';
import { getIceServers, iceStatus } from '../config/iceServers.js';

const ID_PATTERN = /^[A-Za-z0-9_-]{2,24}$/;
const MAX_NAME = 32;
const MAX_SDP = 20000;
const MAX_MESSAGES_PER_SECOND = 60;

const isId = (v) => typeof v === 'string' && ID_PATTERN.test(v);
const isText = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;

function shortenName(name) {
  if (!isText(name, MAX_NAME * 2)) return '';
  return name.replace(/[^\P{C}]+/gu, ' ').trim().slice(0, MAX_NAME);
}

export function registerCallHandlers(io) {
  /** socketId -> user */
  const users = new Map();
  /** userId -> socketId */
  const byUserId = new Map();
  /** callId -> { id, caller, callee, state } */
  const calls = new Map();

  const directory = () =>
    [...users.values()].map((u) => ({ id: u.id, name: u.name, online: true, inCall: u.inCall }));

  const broadcastDirectory = () => {
    io.emit('cv:directory', directory());
  };

  const findUser = (socketId) => users.get(socketId);
  const generateId = () => {
    let id;
    do {
      id = randomUUID().replace(/-/g, '').slice(0, 4).toUpperCase();
    } while (byUserId.has(id));
    return id;
  };
  const userById = (userId) => {
    const socketId = byUserId.get(userId);
    return socketId ? users.get(socketId) : null;
  };

  const send = (userId, event, payload) => {
    const socketId = byUserId.get(userId);
    if (socketId) io.to(socketId).emit(event, payload);
  };

  const fail = (socket, code, message) => socket.emit('cv:error', { code, message });

  const callFor = (userId) => {
    for (const call of calls.values()) {
      if (call.caller === userId || call.callee === userId) return call;
    }
    return null;
  };

  const peerOf = (call, userId) => (call.caller === userId ? call.callee : call.caller);

  const closeCall = (call, reason) => {
    if (!call) return;
    calls.delete(call.id);
    for (const participant of [call.caller, call.callee]) {
      const user = userById(participant);
      if (user) user.inCall = false;
      send(participant, 'cv:ended', { callId: call.id, code: reason });
    }
    broadcastDirectory();
  };

  io.on('connection', (socket) => {
    let bucket = 0;
    let bucketStarted = Date.now();

    // Signaling floods are the realistic abuse vector for a project deployment.
    const guard = (event, payload, handler) => {
      const now = Date.now();
      if (now - bucketStarted > 1000) {
        bucketStarted = now;
        bucket = 0;
      }
      bucket++;
      if (bucket > MAX_MESSAGES_PER_SECOND) {
        fail(socket, 'rate-limited', 'Too many signaling messages. Slowing this client down.');
        return;
      }
      if (typeof payload !== 'object' || payload === null) {
        fail(socket, 'bad-payload', `Malformed ${event} message.`);
        return;
      }
      handler(payload);
    };

    socket.on('cv:register', (payload, ack) => {
      const name = shortenName(payload?.name) || `User ${socket.id.slice(1, 5)}`;
      let requested = isId(payload?.id) ? payload.id : null;
      if (requested && byUserId.has(requested)) requested = null;
      const userId = requested || generateId();

      // A reload reuses the socket, so the previous identity has to be released first or
      // signalling addressed to the old id would keep landing on this connection.
      const previous = users.get(socket.id);
      if (previous && previous.id !== userId) {
        byUserId.delete(previous.id);
        const orphaned = callFor(previous.id);
        if (orphaned) closeCall(orphaned, 'peer-disconnected');
      }

      const user = { id: userId, socketId: socket.id, name, inCall: false };
      users.set(socket.id, user);
      byUserId.set(userId, socket.id);

      const reply = {
        userId,
        name,
        iceServers: getIceServers(),
        ice: iceStatus(),
        directory: directory(),
      };
      if (typeof ack === 'function') ack(reply);
      else socket.emit('cv:registered', reply);
      broadcastDirectory();
    });

    socket.on('cv:rename', (payload) =>
      guard('cv:rename', payload, ({ name }) => {
        const user = findUser(socket.id);
        const clean = shortenName(name);
        if (!user || !clean) return fail(socket, 'bad-payload', 'Invalid display name.');
        user.name = clean;
        broadcastDirectory();
      }),
    );

    socket.on('cv:dial', (payload) =>
      guard('cv:dial', payload, ({ to }) => {
        const user = findUser(socket.id);
        if (!user) return fail(socket, 'not-registered', 'Register before dialling.');
        if (!isId(to)) return fail(socket, 'bad-payload', 'Invalid callee id.');
        if (to === user.id) return fail(socket, 'self-call', 'You cannot call yourself.');

        const callee = userById(to);
        if (!callee) return fail(socket, 'offline', `${to} is not online.`);

        const existing = callFor(user.id) || callFor(callee.id);
        if (existing) return fail(socket, 'busy', 'Either side is already in a call.');

        const call = { id: randomUUID(), caller: user.id, callee: callee.id, state: 'ringing' };
        calls.set(call.id, call);
        user.inCall = true;
        callee.inCall = true;

        socket.emit('cv:dialing', { callId: call.id, to: callee.id, toName: callee.name });
        send(callee.id, 'cv:incoming', {
          code: 'incoming',
          callId: call.id,
          from: user.id,
          fromName: user.name,
          message: `${user.name} is calling`,
        });
        broadcastDirectory();
      }),
    );

    const onlyCallee = (payload, next) => {
      const user = findUser(socket.id);
      const call = calls.get(payload?.callId);
      if (!user || !call) {
        fail(socket, 'no-call', 'No such call.');
        return null;
      }
      if (call.callee !== user.id) {
        fail(socket, 'forbidden', 'Only the callee can answer this call.');
        return null;
      }
      return next(user, call);
    };

    socket.on('cv:accept', (payload) =>
      guard('cv:accept', payload, () =>
        onlyCallee(payload, (user, call) => {
          if (call.state !== 'ringing') return fail(socket, 'stale-call', 'This call is no longer ringing.');
          call.state = 'active';
          send(call.caller, 'cv:accepted', { callId: call.id, from: user.id, fromName: user.name });
        }),
      ),
    );

    socket.on('cv:reject', (payload) =>
      guard('cv:reject', payload, () =>
        onlyCallee(payload, (_user, call) => {
          closeCall(call, 'rejected');
        }),
      ),
    );

    socket.on('cv:hangup', (payload) =>
      guard('cv:hangup', payload, () => {
        const user = findUser(socket.id);
        const call = calls.get(payload?.callId);
        if (!user || !call) return fail(socket, 'no-call', 'No such call.');
        if (call.caller !== user.id && call.callee !== user.id) {
          return fail(socket, 'forbidden', 'You are not part of this call.');
        }
        closeCall(call, 'hangup');
      }),
    );

    /** SDP and ICE are only relayed between the two participants of a live call. */
    const relay = (event) => (payload) =>
      guard(event, payload, ({ callId, to }) => {
        const user = findUser(socket.id);
        const call = calls.get(callId);
        if (!user || !call) return fail(socket, 'no-call', 'Unknown call, signaling dropped.');
        if (call.caller !== user.id && call.callee !== user.id) {
          return fail(socket, 'forbidden', 'You are not part of this call.');
        }
        const peer = peerOf(call, user.id);
        if (to && to !== peer) return fail(socket, 'forbidden', 'Signaling target does not match the call.');
        if (!userById(peer)) return fail(socket, 'offline', 'The remote side is gone.');

        if (event === 'cv:offer') {
          if (!isText(payload.sdp, MAX_SDP)) return fail(socket, 'bad-payload', 'Invalid SDP offer.');
          send(peer, 'cv:offer-to', { callId, from: user.id, sdp: payload.sdp });
        } else if (event === 'cv:answer') {
          if (!isText(payload.sdp, MAX_SDP)) return fail(socket, 'bad-payload', 'Invalid SDP answer.');
          call.state = 'active';
          send(peer, 'cv:answer-to', { callId, from: user.id, sdp: payload.sdp });
        } else if (event === 'cv:ice') {
          const candidate = payload.candidate;
          if (candidate !== null && typeof candidate !== 'object') {
            return fail(socket, 'bad-payload', 'Invalid ICE candidate.');
          }
          send(peer, 'cv:ice-to', { callId, from: user.id, candidate: candidate ?? null });
        }
      });

    socket.on('cv:offer', relay('cv:offer'));
    socket.on('cv:answer', relay('cv:answer'));
    socket.on('cv:ice', relay('cv:ice'));

    socket.on('disconnect', () => {
      const user = findUser(socket.id);
      if (!user) return;
      const call = callFor(user.id);
      if (call) {
        const peer = peerOf(call, user.id);
        closeCall(call, 'peer-disconnected');
        send(peer, 'cv:peer-lost', { callId: call.id, code: 'peer-disconnected', message: 'The remote user disconnected.' });
      }
      users.delete(socket.id);
      byUserId.delete(user.id);
      broadcastDirectory();
    });
  });

  return { directory, calls, users };
}
