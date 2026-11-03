import { useState } from 'react';
import { Copy, Phone, PhoneCall, PhoneIncoming, Search, Server, UserRound } from 'lucide-react';
import type { UseAudioEngine } from '../hooks/useAudioEngine';
import type { UseSocket } from '../hooks/useSocket';
import type { UseWebRtc } from '../hooks/useWebRTC';
import { CallControls } from '../components/CallControls';
import { IncomingCall } from '../components/IncomingCall';
import { RemoteAudio } from '../components/RemoteAudio';
import { StatusPill } from '../components/StatusPill';

interface Props {
  audio: UseAudioEngine;
  socket: UseSocket;
  call: UseWebRtc;
}

export function Calling({ audio, socket, call }: Props) {
  const [target, setTarget] = useState('');
  const [copied, setCopied] = useState(false);

  const copyId = async () => {
    if (!socket.userId) return;
    try {
      await navigator.clipboard.writeText(socket.userId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked - the ID is visible on screen */
    }
  };

  const canDial = socket.status === 'online' && audio.snapshot.running && call.phase === 'idle' && target.trim().length >= 2;

  return (
    <div className="stack">
      {(call.phase === 'incoming' || call.phase === 'outgoing') && (
        <IncomingCall
          phase={call.phase}
          peerId={call.peerId}
          peerName={call.peerName}
          onAccept={call.accept}
          onReject={call.reject}
        />
      )}

      <div className="grid cols-2">
        <div className="card">
          <div className="card-title">
            <UserRound size={14} /> Your identity
          </div>
          <div className="row between">
            <div>
              <div className="peer-name">{socket.name}</div>
              <div className="peer-id">{socket.userId ?? 'not registered'}</div>
            </div>
            <div className="row tight">
              <button className="btn ghost" style={{ padding: '6px 10px' }} onClick={copyId} disabled={!socket.userId}>
                <Copy size={14} /> {copied ? 'Copied' : 'Copy ID'}
              </button>
            </div>
          </div>
          <div className="divider" />
          <div className="field">
            <label className="label" htmlFor="cv-name">
              Display name
            </label>
            <input
              id="cv-name"
              className="input"
              value={socket.name}
              maxLength={32}
              onChange={(e) => socket.rename(e.target.value)}
            />
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <StatusPill tone={socket.status === 'online' ? 'online' : socket.status === 'error' ? 'error' : 'busy'}>
              Signaling {socket.status}
            </StatusPill>
            <StatusPill tone={audio.snapshot.running ? 'online' : 'offline'}>
              Suppression {audio.snapshot.running ? 'active' : 'stopped'}
            </StatusPill>
          </div>
          {!audio.snapshot.running ? (
            <div className="notice warn" style={{ marginTop: 12 }}>
              Start noise processing to place a call - the WebRTC sender uses the processed track, not the raw microphone.
              <div style={{ marginTop: 8 }}>
                <button className="btn primary" onClick={() => void audio.start().catch(() => undefined)}>
                  Start processing
                </button>
              </div>
            </div>
          ) : null}
          {socket.retryIn !== null ? (
            <div className="notice error" style={{ marginTop: 12 }}>
              Cannot reach the signaling server at {window.location.origin === 'http://localhost:5173' ? 'the configured URL' : 'this origin'}
              . Start it with <span className="mono">npm start</span> inside <span className="mono">server/</span>, or set
              <span className="mono"> VITE_SIGNALING_URL</span>. Retrying in {socket.retryIn}s.
            </div>
          ) : null}
          {!socket.turnConfigured && socket.status === 'online' ? (
            <div className="notice info" style={{ marginTop: 12 }}>
              <Server size={14} /> {socket.iceNote}
            </div>
          ) : null}
        </div>

        <div className="card">
          <div className="card-title">
            <Search size={14} /> Place a call
          </div>
          <div className="row tight">
            <input
              className="input"
              style={{ flex: 1 }}
              placeholder="Remote user ID, e.g. 7K3A"
              value={target}
              maxLength={24}
              onChange={(e) => setTarget(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && canDial && call.dial(target)}
            />
            <button className="btn primary" onClick={() => call.dial(target)} disabled={!canDial}>
              <PhoneCall size={16} /> Dial
            </button>
          </div>

          <div className="divider" />
          <div className="metric-label" style={{ marginBottom: 10 }}>Online users</div>
          {socket.peers.length === 0 ? (
            <div className="faint">
              Nobody else is connected. Open this page in a second browser or on another device, wait for it to
              register, and its ID will appear here.
            </div>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              {socket.peers.map((peer) => (
                <div className="peer-row" key={peer.id}>
                  <span className="avatar sm">
                    <UserRound size={16} />
                  </span>
                  <div style={{ flex: 1 }}>
                    <div className="peer-name">{peer.name}</div>
                    <div className="peer-id">{peer.id}</div>
                  </div>
                  <StatusPill tone={peer.inCall ? 'busy' : 'online'}>{peer.inCall ? 'In call' : 'Online'}</StatusPill>
                  <button
                    className="btn"
                    style={{ padding: '7px 12px', fontSize: 13 }}
                    disabled={call.phase !== 'idle' || peer.inCall || !audio.snapshot.running}
                    onClick={() => call.dial(peer.id)}
                  >
                    <Phone size={14} /> Call
                  </button>
                </div>
              ))}
            </div>
          )}
          {call.failure ? <div className="notice error" style={{ marginTop: 12 }}>{call.failure}</div> : null}
          {!call.failure && call.endReason && call.phase !== 'active' ? (
            <div className="notice" style={{ marginTop: 12 }}>Call ended: {call.endReason}</div>
          ) : null}
        </div>
      </div>

      {call.phase === 'active' ? (
        <div className="grid cols-2">
          <div className="stack">
            <div className="card">
              <div className="card-title">Connected call</div>
              <div className="row between">
                <div>
                  <div className="metric-label">You send</div>
                  <div className="peer-name">{socket.name} ({socket.userId})</div>
                  <div className="faint">audio path: mic &rarr; STFT suppression &rarr; RTP</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="metric-label">You receive</div>
                  <div className="peer-name">{call.peerName} ({call.peerId})</div>
                  <div className="faint">remote track played locally, never reprocessed</div>
                </div>
              </div>
            </div>
            <div className="card">
              <div className="card-title">Remote audio playback</div>
              <RemoteAudio stream={call.remoteStream} />
            </div>
          </div>
          <CallControls call={call} onToggleMute={call.toggleMute} onHangup={call.hangup} />
        </div>
      ) : (
        <div className="card call-panel">
          <PhoneIncoming size={26} color="rgba(94,178,255,0.5)" />
          <div className="metric-label" style={{ marginTop: 10 }}>
            No active call &middot; incoming calls ring here automatically
          </div>
          <div className="faint" style={{ marginTop: 6 }}>
            Keep this tab open on the second device; the callee sees the incoming-call screen as soon as you dial their ID.
          </div>
        </div>
      )}

      {!call.supported ? (
        <div className="notice error">
          This browser has no RTCPeerConnection support. Use Chrome, Edge, Firefox or Safari 14.3 or newer.
        </div>
      ) : null}
    </div>
  );
}
