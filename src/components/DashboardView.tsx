import { useState, useEffect, useRef } from 'react';
import type { UserProfile, ContactInfo } from '../utils/userAuth';
import type { LevelReport } from '../audio/types';
import type { OnlineUser, CallStats } from '../types/call';
import { getRecentCalls, type CallRecord } from '../utils/callHistory';

interface Props {
  currentUser: UserProfile;
  levels: LevelReport | null;
  analysers: {
    original: AnalyserNode | null;
    enhanced: AnalyserNode | null;
  };
  isAudioRunning: boolean;
  suppression: number;
  onSuppressionChange: (val: number) => void;
  onlineUsers: OnlineUser[];
  callState: string;
  callStats: CallStats | null;
  onStartCall: (contactId: string, contactName: string) => Promise<void>;
  onHangup: () => void;
  onViewContactProfile?: (contact: ContactInfo) => void;
  onStartAudio: () => Promise<boolean>;
  onStopAudio: () => void;
}

export default function DashboardView({
  currentUser,
  levels,
  analysers,
  isAudioRunning,
  suppression,
  onSuppressionChange,
  onlineUsers,
  callState,
  callStats,
  onStartCall,
  onHangup,
  onStartAudio,
  onStopAudio,
}: Props) {
  const [currentTime, setCurrentTime] = useState<string>('');
  const [currentDate, setCurrentDate] = useState<string>('');
  const [timeFilter, setTimeFilter] = useState<'15m' | '1h' | '6h' | 'all'>('1h');
  const [dialPin, setDialPin] = useState('');
  const [recentCalls, setRecentCalls] = useState<CallRecord[]>([]);

  const originalCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const enhancedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const spectrumCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const radarCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Live clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      setCurrentDate(`${days[now.getDay()]} ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`);
      setCurrentTime(now.toTimeString().split(' ')[0]);
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Recent calls
  useEffect(() => {
    setRecentCalls(getRecentCalls().slice(0, 5));
  }, [callState]);

  // Telemetry Calculations
  const inputRms = levels ? Math.round(levels.inputLevel * 100) : 0;
  const inputDb = levels ? Math.round(Math.max(-60, 20 * Math.log10(levels.inputLevel + 0.0001))) : -60;
  const rtt = callStats ? Math.round(callStats.rtt) : 24;
  const packetLoss = callStats ? callStats.packetLoss.toFixed(1) : '0.0';
  const otherUsers = onlineUsers.filter((u) => u.userId !== currentUser.id);

  // Waveform Render Loop
  useEffect(() => {
    let animId: number;

    const render = () => {
      // 1. Original Waveform
      if (originalCanvasRef.current && analysers.original) {
        const canvas = originalCanvasRef.current;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const bufferLength = analysers.original.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);
          analysers.original.getByteTimeDomainData(dataArray);

          ctx.fillStyle = '#0d1527';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          // Grid lines
          ctx.strokeStyle = '#1e293b';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, canvas.height / 2);
          ctx.lineTo(canvas.width, canvas.height / 2);
          ctx.stroke();

          // Wave
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#38bdf8';
          ctx.beginPath();
          const sliceWidth = canvas.width / bufferLength;
          let x = 0;
          for (let i = 0; i < bufferLength; i++) {
            const v = dataArray[i] / 128.0;
            const y = (v * canvas.height) / 2;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
            x += sliceWidth;
          }
          ctx.stroke();
        }
      }

      // 2. Enhanced Waveform
      if (enhancedCanvasRef.current && analysers.enhanced) {
        const canvas = enhancedCanvasRef.current;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const bufferLength = analysers.enhanced.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);
          analysers.enhanced.getByteTimeDomainData(dataArray);

          ctx.fillStyle = '#0d1527';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          // Grid lines
          ctx.strokeStyle = '#1e293b';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, canvas.height / 2);
          ctx.lineTo(canvas.width, canvas.height / 2);
          ctx.stroke();

          // Wave
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#10b981';
          ctx.beginPath();
          const sliceWidth = canvas.width / bufferLength;
          let x = 0;
          for (let i = 0; i < bufferLength; i++) {
            const v = dataArray[i] / 128.0;
            const y = (v * canvas.height) / 2;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
            x += sliceWidth;
          }
          ctx.stroke();
        }
      }

      // 3. Spectrum Analyzer
      if (spectrumCanvasRef.current && (analysers.enhanced || analysers.original)) {
        const targetAnalyser = analysers.enhanced || analysers.original;
        const canvas = spectrumCanvasRef.current;
        const ctx = canvas.getContext('2d');
        if (ctx && targetAnalyser) {
          const bufferLength = targetAnalyser.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);
          targetAnalyser.getByteFrequencyData(dataArray);

          ctx.fillStyle = '#0d1527';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          const barWidth = (canvas.width / bufferLength) * 2.5;
          let x = 0;
          for (let i = 0; i < bufferLength; i++) {
            const barHeight = (dataArray[i] / 255) * canvas.height;
            const hue = (i / bufferLength) * 200 + 160;
            ctx.fillStyle = `hsl(${hue}, 90%, 50%)`;
            ctx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight);
            x += barWidth;
            if (x > canvas.width) break;
          }
        }
      }

      // 4. Acoustic Radar Simulation
      if (radarCanvasRef.current) {
        const canvas = radarCanvasRef.current;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = 'rgba(13, 21, 39, 0.2)';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          const cx = canvas.width / 2;
          const cy = canvas.height / 2;
          const radius = Math.min(cx, cy) - 15;

          // Concentric circles
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
          ctx.lineWidth = 1;
          for (let r = radius / 3; r <= radius; r += radius / 3) {
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.stroke();
          }

          // Crosshairs
          ctx.beginPath();
          ctx.moveTo(cx - radius, cy);
          ctx.lineTo(cx + radius, cy);
          ctx.moveTo(cx, cy - radius);
          ctx.lineTo(cx, cy + radius);
          ctx.stroke();

          // Sweep line
          const angle = (Date.now() / 600) % (Math.PI * 2);
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
          ctx.stroke();

          // Audio pulse dot
          const pulse = (levels?.inputLevel || 0.1) * radius * 0.8;
          ctx.fillStyle = callState === 'connected' ? '#10b981' : '#f59e0b';
          ctx.beginPath();
          ctx.arc(cx, cy, Math.max(4, pulse), 0, Math.PI * 2);
          ctx.fill();
        }
      }

      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, [analysers, levels, callState]);

  const handleDial = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = dialPin.trim().replace(/^#/, '');
    if (!clean) return;
    const target = otherUsers.find((u) => u.userId === clean || u.userName.toLowerCase() === clean.toLowerCase());
    onStartCall(clean, target?.userName || `User #${clean}`);
    setDialPin('');
  };

  return (
    <div className="telemetry-main">
      {/* ── Top Header Bar ── */}
      <header className="telemetry-header">
        <div className="header-title-wrap">
          <h1>Voice Engine Overview</h1>
          <p>
            Terminal #{currentUser.id} · Intelligent Real-Time Noise Suppression &amp; WebRTC Telecom
          </p>
        </div>

        <div className="header-actions">
          <div className="header-clock">
            <div className="clock-time">{currentDate} {currentTime}</div>
            <div className="clock-meta">DSP Sample Rate: 48.0 kHz · WebRTC Opus</div>
          </div>

          {callState === 'connected' ? (
            <button className="header-status-btn" onClick={onHangup} style={{ background: '#fee2e2', color: '#dc2626' }}>
              🔴 END CALL
            </button>
          ) : isAudioRunning ? (
            <button className="header-status-btn green" onClick={onStopAudio}>
              ● SYSTEM OPERATIONAL
            </button>
          ) : (
            <button className="header-status-btn" onClick={onStartAudio}>
              ⚡ START AUDIO ENGINE
            </button>
          )}
        </div>
      </header>

      {/* ── Dynamic Alert Banner (Matching TowerWatch Red Banner) ── */}
      {callState === 'connected' ? (
        <div className="telemetry-alert-banner" style={{ backgroundColor: '#10b981' }}>
          <span className="alert-icon-flash">●</span>
          CALL IN PROGRESS — WebRTC P2P direct audio stream active with AI noise cancellation
        </div>
      ) : inputDb > -20 && isAudioRunning ? (
        <div className="telemetry-alert-banner">
          <span className="alert-icon-flash">⚠️</span>
          ALERT: High ambient noise detected ({inputDb} dB) — Neural DSP Spectral Filter engaged
        </div>
      ) : (
        <div className="telemetry-alert-banner" style={{ backgroundColor: '#1e293b' }}>
          <span>ℹ️</span>
          TELECOM READY — Enter a peer PIN or select an online user from the terminal to connect
        </div>
      )}

      {/* ── 6 Metric Cards Row ── */}
      <section className="telemetry-cards-grid">
        {/* Card 1: Noise Level */}
        <div className="metric-card">
          <div className="metric-card-header">
            <span className="metric-card-title">Noise Floor</span>
            <div className="metric-card-icon-wrap icon-pink">🌡️</div>
          </div>
          <div className="metric-card-value">{inputDb} <span style={{ fontSize: 14 }}>dB</span></div>
          <div className="metric-card-footer">
            <span className="metric-tag tag-normal">● Normal</span>
            <span className="metric-limit-text">Threshold -20 dB</span>
          </div>
        </div>

        {/* Card 2: AI Suppression */}
        <div className="metric-card">
          <div className="metric-card-header">
            <span className="metric-card-title">AI Suppression</span>
            <div className="metric-card-icon-wrap icon-blue">💧</div>
          </div>
          <div className="metric-card-value">{Math.round(suppression * 100)} <span style={{ fontSize: 14 }}>%</span></div>
          <div className="metric-card-footer">
            <span className="metric-tag tag-normal">● Active</span>
            <span className="metric-limit-text">Spectral Subtraction</span>
          </div>
        </div>

        {/* Card 3: Input RMS */}
        <div className="metric-card">
          <div className="metric-card-header">
            <span className="metric-card-title">Input Signal</span>
            <div className="metric-card-icon-wrap icon-emerald">☁️</div>
          </div>
          <div className="metric-card-value">{inputRms} <span style={{ fontSize: 14 }}>%</span></div>
          <div className="metric-card-footer">
            <span className="metric-tag tag-normal">● Normal</span>
            <span className="metric-limit-text">Limit 85%</span>
          </div>
        </div>

        {/* Card 4: Audio Latency */}
        <div className="metric-card">
          <div className="metric-card-header">
            <span className="metric-card-title">Audio Latency</span>
            <div className="metric-card-icon-wrap icon-orange">⏱️</div>
          </div>
          <div className="metric-card-value">{rtt} <span style={{ fontSize: 14 }}>ms</span></div>
          <div className="metric-card-footer">
            <span className="metric-tag tag-normal">● Ultra-Low</span>
            <span className="metric-limit-text">Limit ±50 ms</span>
          </div>
        </div>

        {/* Card 5: Packet Loss */}
        <div className="metric-card">
          <div className="metric-card-header">
            <span className="metric-card-title">Packet Health</span>
            <div className="metric-card-icon-wrap icon-purple">📶</div>
          </div>
          <div className="metric-card-value">{packetLoss} <span style={{ fontSize: 14 }}>%</span></div>
          <div className="metric-card-footer">
            <span className="metric-tag tag-normal">● Stable</span>
            <span className="metric-limit-text">Opus 48kHz</span>
          </div>
        </div>

        {/* Card 6: Health / State */}
        <div className="metric-card">
          <div className="metric-card-header">
            <span className="metric-card-title">System Status</span>
            <div className="metric-card-icon-wrap icon-red">🛡️</div>
          </div>
          <div className="metric-card-value" style={{ textTransform: 'capitalize' }}>
            {callState === 'connected' ? 'In Call' : isAudioRunning ? 'Ready' : 'Standby'}
          </div>
          <div className="metric-card-footer">
            <span className="metric-tag tag-normal">● {otherUsers.length} Online</span>
            <span className="metric-limit-text">P2P Mesh</span>
          </div>
        </div>
      </section>

      {/* ── Main Content: Trends + Voice Terminal ── */}
      <div className="telemetry-content-layout">
        {/* Left Trends Panel (70%) */}
        <section className="trends-panel">
          <div className="trends-header">
            <h2>Audio &amp; DSP Telemetry Trends</h2>
            <div className="time-filter-pills">
              <button
                className={`time-pill-btn ${timeFilter === '15m' ? 'active' : ''}`}
                onClick={() => setTimeFilter('15m')}
              >
                15 min
              </button>
              <button
                className={`time-pill-btn ${timeFilter === '1h' ? 'active' : ''}`}
                onClick={() => setTimeFilter('1h')}
              >
                1 hour
              </button>
              <button
                className={`time-pill-btn ${timeFilter === '6h' ? 'active' : ''}`}
                onClick={() => setTimeFilter('6h')}
              >
                6 hours
              </button>
              <button
                className={`time-pill-btn ${timeFilter === 'all' ? 'active' : ''}`}
                onClick={() => setTimeFilter('all')}
              >
                All
              </button>
            </div>
          </div>

          <div className="trends-charts-grid">
            {/* Chart 1: Raw Microphone Waveform */}
            <div className="trend-chart-box">
              <div className="chart-box-title">
                <span>Raw Input Waveform</span>
                <span style={{ fontSize: 11, color: '#38bdf8' }}>CH-1 RAW</span>
              </div>
              <div className="chart-canvas-wrap">
                <canvas ref={originalCanvasRef} width={400} height={140} style={{ width: '100%', height: '100%' }} />
              </div>
            </div>

            {/* Chart 2: Enhanced Output Waveform */}
            <div className="trend-chart-box">
              <div className="chart-box-title">
                <span>Enhanced Waveform (Post-DSP)</span>
                <span style={{ fontSize: 11, color: '#10b981' }}>CH-2 CLEAN</span>
              </div>
              <div className="chart-canvas-wrap">
                <canvas ref={enhancedCanvasRef} width={400} height={140} style={{ width: '100%', height: '100%' }} />
              </div>
            </div>

            {/* Chart 3: Real-time FFT Frequency Spectrum */}
            <div className="trend-chart-box">
              <div className="chart-box-title">
                <span>Frequency Spectrum Analyzer (FFT)</span>
                <span style={{ fontSize: 11, color: '#f59e0b' }}>0 - 24 kHz</span>
              </div>
              <div className="chart-canvas-wrap">
                <canvas ref={spectrumCanvasRef} width={400} height={140} style={{ width: '100%', height: '100%' }} />
              </div>
            </div>

            {/* Chart 4: Noise Suppression Level Control */}
            <div className="trend-chart-box">
              <div className="chart-box-title">
                <span>Noise Suppression Intensity</span>
                <span style={{ fontSize: 11, color: '#8b5cf6' }}>{Math.round(suppression * 100)}%</span>
              </div>
              <div
                style={{
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  gap: 12,
                  background: '#0d1527',
                  borderRadius: 4,
                  height: 140,
                  boxSizing: 'border-box',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', fontSize: 12 }}>
                  <span>Low (Transparent)</span>
                  <span style={{ color: '#10b981', fontWeight: 700 }}>Optimal (85%)</span>
                  <span>Maximum (Aggressive)</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={suppression}
                  onChange={(e) => onSuppressionChange(parseFloat(e.target.value))}
                  style={{ width: '100%', accentColor: '#2563eb', cursor: 'pointer' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', fontSize: 11 }}>
                  <span>Filter: Spectral Gating</span>
                  <span>Buffer: 128 samples</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Right Terminal Panel (30%) */}
        <aside className="terminal-panel">
          {/* Radar Box */}
          <div className="terminal-card">
            <div className="terminal-card-header">
              <h3>Acoustic Radar &amp; Telemetry</h3>
              <span style={{ fontSize: 11, color: '#38bdf8', fontWeight: 700 }}>ACTIVE</span>
            </div>
            <div className="radar-display-box">
              <canvas ref={radarCanvasRef} width={280} height={180} style={{ width: '100%', height: '100%' }} />
              <div className="radar-telemetry-overlay">
                <span>ICE: STUN/TURN</span>
                <span>STATE: {callState.toUpperCase()}</span>
              </div>
            </div>
          </div>

          {/* Quick Call Dial Terminal */}
          <div className="terminal-card">
            <div className="terminal-card-header">
              <h3>Voice Terminal · Quick Call</h3>
              <span style={{ fontSize: 12, color: '#10b981', fontWeight: 700 }}>Your PIN: #{currentUser.id}</span>
            </div>

            <form onSubmit={handleDial} className="pin-dial-box">
              <input
                type="text"
                className="pin-dial-input"
                placeholder="Enter Peer PIN (e.g. 1042)"
                value={dialPin}
                onChange={(e) => setDialPin(e.target.value)}
              />
              <button type="submit" className="pin-call-btn" disabled={!dialPin.trim()}>
                📞 CALL PEER NOW
              </button>
            </form>
          </div>

          {/* Online Peers List */}
          <div className="terminal-card">
            <div className="terminal-card-header">
              <h3>Online Peers ({otherUsers.length})</h3>
              <span style={{ fontSize: 11, color: '#64748b' }}>Live</span>
            </div>

            {otherUsers.length === 0 ? (
              <p style={{ fontSize: 12, color: '#94a3b8', margin: '8px 0' }}>
                No other peers currently online. Give your PIN (#{currentUser.id}) to a friend to connect.
              </p>
            ) : (
              <div className="terminal-peers-list">
                {otherUsers.map((user) => (
                  <div key={user.userId} className="terminal-peer-item">
                    <div className="peer-name-wrap">
                      <div className="peer-avatar-circle">{user.userName.slice(0, 2).toUpperCase()}</div>
                      <div className="peer-info-text">
                        <strong>{user.userName}</strong>
                        <span>#{user.userId}</span>
                      </div>
                    </div>
                    <button
                      className="peer-call-mini-btn"
                      onClick={() => onStartCall(user.userId, user.userName)}
                    >
                      CALL
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Activity */}
          {recentCalls.length > 0 && (
            <div className="terminal-card">
              <div className="terminal-card-header">
                <h3>Recent Activity</h3>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {recentCalls.map((c) => (
                  <div
                    key={c.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: 11,
                      padding: '4px 0',
                      borderBottom: '1px solid #f1f5f9',
                    }}
                  >
                    <span style={{ color: '#334155', fontWeight: 600 }}>Peer #{c.roomCode}</span>
                    <span style={{ color: '#94a3b8' }}>{c.durationSec ? `${c.durationSec}s` : 'Call'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* ── Bottom Telemetry Footer Bar ── */}
      <footer className="telemetry-footer-bar">
        <div>
          Source: WebRTC ICE Host · Node: <code>{window.location.hostname}</code> · Buffer: 128 samples
        </div>
        <div>
          DSP Engine: Worklet Active · Codec: Opus/48000/2 · Polling: 2s
        </div>
      </footer>
    </div>
  );
}
