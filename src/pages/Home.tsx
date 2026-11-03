import { useEffect, useState } from 'react';
import { Activity, ArrowRight, AudioLines, History, Mic, PhoneCall, ShieldCheck, Trash2 } from 'lucide-react';
import type { UseAudioEngine } from '../hooks/useAudioEngine';
import type { UseSocket } from '../hooks/useSocket';
import type { UseWebRtc } from '../hooks/useWebRTC';
import { clearCalls, recentCalls, type CallRecord } from '../services/callHistory';
import { StatusPill } from '../components/StatusPill';
import { formatDuration } from '../audio/audioUtils';

interface Props {
  audio: UseAudioEngine;
  socket: UseSocket;
  call: UseWebRtc;
  onStartCalls: () => void;
  historyVersion: number;
}

export function Home({ audio, socket, call, onStartCalls, historyVersion }: Props) {
  const [history, setHistory] = useState<CallRecord[]>(() => recentCalls());
  useEffect(() => setHistory(recentCalls()), [historyVersion]);
  const stats = audio.snapshot.stats;

  return (
    <div className="stack">
      <div className="hero">
        <div className="row between">
          <div>
            <h1>ClearVoice</h1>
            <p>
              Real-time adaptive noise suppression for IP voice communication. Microphone audio is framed,
              transformed to the frequency domain, cleaned with adaptive spectral subtraction, and only then
              handed to WebRTC - so a rider on a moving motorcycle can be understood over a call.
            </p>
          </div>
          <AudioLines size={68} color="rgba(94,178,255,0.24)" strokeWidth={1.2} />
        </div>

        <div className="row" style={{ marginTop: 22, gap: 10 }}>
          <button className="btn primary lg" onClick={() => void audio.start()} disabled={audio.snapshot.running || audio.starting}>
            <Mic size={17} /> {audio.snapshot.running ? 'Processing active' : audio.starting ? 'Requesting microphone...' : 'Start processing'}
          </button>
          <button
            className="btn lg"
            onClick={onStartCalls}
            disabled={!audio.snapshot.running || call.phase !== 'idle'}
            title={audio.snapshot.running ? 'Open the calling interface' : 'Start processing first'}
          >
            <PhoneCall size={17} /> Start call <ArrowRight size={15} />
          </button>
        </div>

        <div className="row" style={{ marginTop: 16 }}>
          <StatusPill tone={socket.status === 'online' ? 'online' : socket.status === 'error' ? 'error' : 'busy'}>
            Signaling: {socket.status}
          </StatusPill>
          <StatusPill tone={audio.snapshot.running ? 'online' : 'offline'} pulse={audio.snapshot.running}>
            Suppression: {audio.snapshot.running ? (stats.bypass ? 'running (bypassed)' : 'active') : 'stopped'}
          </StatusPill>
          <StatusPill tone={call.phase === 'active' ? 'live' : 'idle'}>
            Call: {call.phase}
          </StatusPill>
          <span className="pill">
            <ShieldCheck size={12} /> {socket.turnConfigured ? 'STUN + TURN' : 'STUN only'}
          </span>
        </div>

        {audio.error ? <div className="notice error" style={{ marginTop: 14 }}>{audio.error}</div> : null}
        {socket.error ? <div className="notice warn" style={{ marginTop: 14 }}>{socket.error}</div> : null}
        {socket.retryIn !== null ? (
          <div className="notice warn" style={{ marginTop: 14 }}>
            Signaling server unreachable. Retrying in {socket.retryIn}s - start it with
            <span className="mono"> npm start</span> in <span className="mono">server/</span>.
          </div>
        ) : null}
      </div>

      <div className="grid cols-4">
        <div className="card">
          <div className="metric-label">Your user ID</div>
          <div className="metric-value mono">{socket.userId ?? '-----'}</div>
          <div className="faint">Share this with the remote user</div>
        </div>
        <div className="card">
          <div className="metric-label">Measured noise reduction</div>
          <div className={`metric-value ${stats.suppressionDb > 0 ? 'pos' : ''}`}>
            {audio.snapshot.running ? stats.suppressionDb.toFixed(1) : '--'}
            <span className="metric-unit">dB</span>
          </div>
          <div className="faint">Input floor minus output floor</div>
        </div>
        <div className="card">
          <div className="metric-label">Processing latency</div>
          <div className="metric-value">
            {audio.snapshot.running ? stats.algorithmLatencyMs.toFixed(1) : '--'}
            <span className="metric-unit">ms</span>
          </div>
          <div className="faint">STFT delay (N/fs), excludes network</div>
        </div>
        <div className="card">
          <div className="metric-label">Speech state</div>
          <div className="metric-value" style={{ color: stats.speechDetected ? 'var(--success)' : undefined }}>
            {audio.snapshot.running ? (stats.speechDetected ? 'SPEECH' : 'NOISE') : '--'}
          </div>
          <div className="faint">VAD probability {(stats.speechProbability * 100).toFixed(0)}%</div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <Activity size={14} /> Live processor readout
        </div>
        <div className="grid cols-4" style={{ gap: 12 }}>
          <div>
            <div className="metric-value small mono">{audio.snapshot.running ? stats.noiseFloorDb.toFixed(1) : '--'}</div>
            <div className="metric-label">Input noise floor dBFS</div>
          </div>
          <div>
            <div className="metric-value small mono">{audio.snapshot.running ? stats.residualFloorDb.toFixed(1) : '--'}</div>
            <div className="metric-label">Residual floor dBFS</div>
          </div>
          <div>
            <div className="metric-value small mono">{audio.snapshot.running ? stats.avgGainDb.toFixed(1) : '--'}</div>
            <div className="metric-label">Mean speech-band gain dB</div>
          </div>
          <div>
            <div className="metric-value small mono">{audio.snapshot.running ? `${(stats.cpuLoad * 100).toFixed(1)}%` : '--'}</div>
            <div className="metric-label">Audio-thread CPU load</div>
          </div>
        </div>
        <div className="faint" style={{ marginTop: 12 }}>
          {stats.framesProcessed.toLocaleString()} frames processed &middot; {stats.clipped} samples limited &middot;
          graph latency {audio.snapshot.baseLatencyMs.toFixed(1)} ms + output {audio.snapshot.outputLatencyMs.toFixed(1)} ms
        </div>
      </div>

      <div className="card">
        <div className="card-title row between">
          <span className="row tight">
            <History size={14} /> Recent calls
          </span>
          {history.length > 0 ? (
            <button
              className="btn ghost"
              style={{ padding: '4px 10px', fontSize: 12 }}
              onClick={() => {
                clearCalls();
                setHistory([]);
              }}
            >
              <Trash2 size={13} /> Clear
            </button>
          ) : null}
        </div>
        {history.length === 0 ? (
          <div className="faint">No calls yet. Calls you place or accept appear here (stored locally only).</div>
        ) : (
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Direction</th>
                  <th>Peer</th>
                  <th>Duration</th>
                  <th>Ended by</th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry, i) => (
                  <tr key={`${entry.startedAt}-${i}`}>
                    <td className="text">{new Date(entry.startedAt).toLocaleTimeString()}</td>
                    <td className="text">{entry.direction === 'in' ? 'Incoming' : 'Outgoing'}</td>
                    <td className="text">
                      {entry.peerName} <span className="peer-id">({entry.peerId})</span>
                    </td>
                    <td>{formatDuration(entry.durationMs)}</td>
                    <td className="text faint">{entry.endReason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
