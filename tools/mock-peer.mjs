/**
 * Command-line signalling peer, for testing the browser UI without a second device.
 *
 * It speaks the real protocol against the real server (registration, directory presence,
 * dial, accept, reject, hangup) but it has no WebRTC stack, so it can never complete a media
 * call. Use it to check that the app shows an online peer, rings on an incoming call, and
 * returns to idle after a reject - not as a substitute for the two-browser test.
 *
 * Usage (PowerShell):
 *   node tools/mock-peer.mjs                       register and idle, print the directory
 *   node tools/mock-peer.mjs --dial 7K3A           ring the browser user with that id
 *   node tools/mock-peer.mjs --answer              wait for an incoming call and accept it
 *   node tools/mock-peer.mjs --reject              wait for an incoming call and reject it
 */

import { io } from 'socket.io-client';

const url = (process.env.VITE_SIGNALING_URL || 'http://localhost:3001').replace(/\/+$/, '');
const args = new Set(process.argv.slice(2));
const getFlagValue = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const dialTarget = getFlagValue('--dial');
const autoAnswer = args.has('--answer');
const autoReject = args.has('--reject') || !autoAnswer;

const socket = io(url, { transports: ['websocket', 'polling'] });

socket.on('connect_error', (err) => {
  console.log(`[mock-peer] cannot reach ${url}: ${err.message}`);
  process.exit(1);
});

socket.on('cv:error', (payload) => console.log(`[mock-peer] server refused: ${payload.code} - ${payload.message}`));
socket.on('cv:directory', (list) => console.log(`[mock-peer] directory: ${list.map((u) => `${u.id}(${u.name}${u.inCall ? ', in call' : ''})`).join(' ') || 'nobody'}`));
socket.on('cv:accepted', (payload) => console.log(`[mock-peer] ${payload.fromName} accepted - a browser peer would now open a peer connection`));
socket.on('cv:ended', (payload) => console.log(`[mock-peer] call ${payload.callId} ended (${payload.code})`));
socket.on('cv:peer-lost', () => console.log('[mock-peer] the remote side disappeared'));

socket.on('cv:incoming', (payload) => {
  console.log(`[mock-peer] incoming call ${payload.callId} from ${payload.fromName} (${payload.from})`);
  socket.emit(autoAnswer ? 'cv:accept' : 'cv:reject', { callId: payload.callId });
  console.log(`[mock-peer] ${autoAnswer ? 'accepted' : 'rejected'} it automatically`);
});

socket.on('cv:dialing', (payload) => console.log(`[mock-peer] ringing ${payload.toName} (${payload.to})...`));
socket.on('cv:rejected', () => console.log('[mock-peer] the callee rejected the call'));

socket.on('connect', () => {
  socket.emit('cv:register', { name: 'CLI peer' }, (reply) => {
    console.log(`[mock-peer] registered as ${reply.name} / id ${reply.userId}`);
    console.log(`[mock-peer] ICE: ${reply.ice.stun} | TURN configured: ${reply.ice.turnConfigured}`);
    if (dialTarget) socket.emit('cv:dial', { to: dialTarget.toUpperCase() });
    else console.log('[mock-peer] idle. Open the app in a browser and dial this id, or pass --dial <id>.');
  });
});

process.on('SIGINT', () => {
  socket.close();
  process.exit(0);
});
