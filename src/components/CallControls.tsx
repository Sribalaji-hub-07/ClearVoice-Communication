import { Mic, MicOff, PhoneOff, Activity, Wifi, Radio } from 'lucide-react';
import type { UseWebRtc } from '../hooks/useWebRTC';
import { StatusPill } from './StatusPill';

interface Props {
  call: UseWebRtc;
  onToggleMute: () => void;
  onHangup: () => void;
}

function toneFor(connection: string): 'online' | 'busy' | 'offline' {
  if (connection === 'connected') return 'online';
  if (connection === 'disconnected' || connection === 'failed' || connection === 'closed') return 'offline';
  return 'busy';
}

export function CallControls({ call, onToggleMute, onHangup }: Props) {
  const m = call.metrics;
  return (
    <div className="card call-panel">
      <div className="row" style={{ justifyContent: 'center' }}>
        <StatusPill tone={toneFor(call.connection)} pulse={call.connection === 'connected'}>
          {call.connection === 'connected' ? 'Connected' : call.connection === 'new' ? 'Negotiating' : call.connection}
        </StatusPill>
        <span className="pill">
          <Radio size={12} /> ICE: {call.ice}
        </span>
      </div>

      <div className="metric-value" style={{ marginTop: 14 }}>
        {call.durationLabel}
      </div>
      <div className="metric-label">Call duration</div>

      <div className="divider" />

      <div className="row" style={{ justifyContent: 'center', gap: 14 }}>
        <button className={`btn icon ${call.muted ? 'danger' : ''}`} onClick={onToggleMute} title={call.muted ? 'Unmute microphone' : 'Mute microphone'}>
          {call.muted ? <MicOff size={18} /> : <Mic size={18} />}
        </button>
        <button className="btn danger lg" onClick={onHangup}>
          <PhoneOff size={17} /> End call
        </button>
      </div>

      <div className="grid cols-4" style={{ marginTop: 18, gap: 10 }}>
        <div>
          <div className="metric-value small">{m.available ? m.roundTripMs.toFixed(0) : '--'}</div>
          <div className="metric-label">RTT ms</div>
        </div>
        <div>
          <div className="metric-value small">{m.available ? m.jitterMs.toFixed(1) : '--'}</div>
          <div className="metric-label">Jitter ms</div>
        </div>
        <div>
          <div className={`metric-value small ${m.packetLossPercent > 2 ? 'neg' : 'pos'}`}>
            {m.available ? `${m.packetLossPercent.toFixed(2)}%` : '--'}
          </div>
          <div className="metric-label">Packet loss</div>
        </div>
        <div>
          <div className="metric-value small">{m.available ? m.inboundBitrateKbps.toFixed(0) : '--'}</div>
          <div className="metric-label">Inbound kbps</div>
        </div>
      </div>

      <div className="row tight faint" style={{ justifyContent: 'center', marginTop: 12 }}>
        <Activity size={13} /> audio: {m.codec} &middot; jitter buffer {m.jitterBufferMs.toFixed(0)} ms
        <Wifi size={13} /> {m.packetsSent} sent / {m.packetsLost} lost
      </div>
      {call.muted ? <div className="faint" style={{ marginTop: 8 }}>Microphone muted - the remote side hears silence.</div> : null}
    </div>
  );
}
