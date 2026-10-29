import React, { useState, useEffect } from 'react';
import type { LevelReport } from '../audio/types';
import type { UserProfile, ContactInfo } from '../utils/userAuth';
import type { OnlineUser, CallState, CallStats } from '../types/call';
import { getRecentCalls, type CallRecord } from '../utils/callHistory';
import SoundWaveVisualizer from './SoundWaveVisualizer';

interface Props {
  currentUser: UserProfile;
  levels: LevelReport | null;
  analysers: { original: AnalyserNode | null; enhanced: AnalyserNode | null };
  isAudioRunning: boolean;
  suppression: number;
  onSuppressionChange: (v: number) => void;
  onlineUsers: OnlineUser[];
  callState: CallState;
  callStats: CallStats | null;
  onStartCall: (targetId: string, targetName: string) => void;
  onHangup: () => void;
  onViewContactProfile: (contact: ContactInfo) => void;
  onStartAudio: () => void;
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
  onStartAudio,
  onStopAudio,
}: Props) {
  const [currentTime, setCurrentTime] = useState('');
  const [currentDate, setCurrentDate] = useState('');
  const [dialTarget, setDialTarget] = useState('');
  const [recentCalls, setRecentCalls] = useState<CallRecord[]>([]);

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

  useEffect(() => {
    setRecentCalls(getRecentCalls().slice(0, 5));
  }, [callState]);

  const inputRms = levels ? Math.round(levels.inputLevel * 100) : 0;
  const inputDb = levels
    ? Math.max(-60, Math.round(20 * Math.log10(levels.noiseFloorEnergy + 0.0001)))
    : -45;
  const rtt = callStats ? Math.round(callStats.rtt) : 18;

  const otherUsers = onlineUsers.filter(
    (u) => u.userId.toLowerCase() !== (currentUser.username || currentUser.id).toLowerCase()
  );

  const handleDial = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = dialTarget.trim().toLowerCase().replace(/^@/, '').replace(/^#/, '');
    if (!clean) return;
    const target = otherUsers.find(
      (u) =>
        u.userId.toLowerCase() === clean ||
        u.userName.toLowerCase() === clean
    );
    const targetId = target ? target.userId : clean;
    const targetName = target ? target.userName : `@${clean}`;
    onStartCall(targetId, targetName);
    setDialTarget('');
  };

  return (
    <div className="telemetry-main-dark">
      {/* ── Top Header Bar ── */}
      <header className="dark-dashboard-header">
        <div className="header-brand-wrap">
          <h1>Voice Operations Dashboard</h1>
          <p>Real-Time Spectral Subtraction &amp; WebRTC Telemetry</p>
        </div>

        <div className="header-actions-dark">
          <div className="header-clock-dark">
            <div className="clock-time-dark">{currentTime}</div>
            <div className="clock-meta-dark">{currentDate}</div>
          </div>

          <button
            className={`audio-engine-toggle-btn ${isAudioRunning ? 'active' : ''}`}
            onClick={isAudioRunning ? onStopAudio : onStartAudio}
          >
            <span className="btn-indicator-dot" />
            {isAudioRunning ? 'DSP Active' : 'Start Mic DSP'}
          </button>
        </div>
      </header>

      {/* ── Metric Cards Row (Removed AI Suppression, Peak Health & System Status info) ── */}
      <section className="dark-metric-cards-grid">
        {/* Card 1: Noise Floor */}
        <div className="dark-metric-card">
          <div className="metric-header-dark">
            <span className="metric-title-dark">Ambient Noise Floor</span>
            <span className="metric-icon-dark">🎙️</span>
          </div>
          <div className="metric-value-dark">
            {inputDb} <span className="metric-unit-dark">dB</span>
          </div>
          <div className="metric-footer-dark">
            <span className="metric-pill-green">● Clean</span>
            <span className="metric-subtext-dark">Threshold: -30 dB</span>
          </div>
        </div>

        {/* Card 2: Input Signal RMS */}
        <div className="dark-metric-card">
          <div className="metric-header-dark">
            <span className="metric-title-dark">Mic Input Energy</span>
            <span className="metric-icon-dark">📊</span>
          </div>
          <div className="metric-value-dark">
            {inputRms} <span className="metric-unit-dark">%</span>
          </div>
          <div className="metric-footer-dark">
            <span className="metric-pill-green">● Optimal</span>
            <span className="metric-subtext-dark">Float32 48kHz</span>
          </div>
        </div>

        {/* Card 3: Audio Latency */}
        <div className="dark-metric-card">
          <div className="metric-header-dark">
            <span className="metric-title-dark">Audio Latency (RTT)</span>
            <span className="metric-icon-dark">⚡</span>
          </div>
          <div className="metric-value-dark">
            {rtt} <span className="metric-unit-dark">ms</span>
          </div>
          <div className="metric-footer-dark">
            <span className="metric-pill-green">● Ultra-Low</span>
            <span className="metric-subtext-dark">Opus WebRTC</span>
          </div>
        </div>
      </section>

      {/* ── Main Layout: Visualizer & Voice Terminal ── */}
      <div className="dark-content-split">
        {/* Left Column: Sound Waveform Visualizer (Exact Image 1) */}
        <section className="dark-visualizer-section">
          <div className="section-title-bar">
            <div>
              <h2>Live Audio Equalizer Spectrum</h2>
              <p>Real-time symmetric voice frequencies &amp; noise gated output</p>
            </div>
            <span className="live-status-tag">
              {isAudioRunning ? '● LIVE AUDIO' : '○ STANDBY'}
            </span>
          </div>

          {/* Soundwave Bar Visualizer matching Image 1 */}
          <div className="waveform-container-dark">
            <SoundWaveVisualizer
              analyser={analysers.enhanced || analysers.original}
              isActive={isAudioRunning}
              barColor="#ffffff"
              bgColor="#06101e"
              barCount={64}
              height={220}
            />
          </div>

          {/* Sound Control Slider */}
          <div className="dsp-intensity-card">
            <div className="intensity-labels">
              <span>Noise Reduction Intensity</span>
              <strong>{Math.round(suppression * 100)}%</strong>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={suppression}
              onChange={(e) => onSuppressionChange(parseFloat(e.target.value))}
              className="dsp-slider-input"
            />
            <div className="intensity-markers">
              <span>Transparent</span>
              <span style={{ color: '#00a884', fontWeight: 600 }}>Recommended (85%)</span>
              <span>Max Isolation</span>
            </div>
          </div>
        </section>

        {/* Right Column: Voice Terminal / Quick Dial */}
        <aside className="dark-terminal-section">
          {/* Quick Call by Username */}
          <div className="terminal-card-dark">
            <div className="terminal-card-header">
              <h3>Voice Terminal · Dial Peer</h3>
              <span className="pin-highlight">@{currentUser.username || currentUser.id}</span>
            </div>

            <form onSubmit={handleDial} className="dial-form-dark">
              <div className="dial-input-wrap">
                <span>@</span>
                <input
                  type="text"
                  placeholder="Enter username (e.g. sribalaji)"
                  value={dialTarget}
                  onChange={(e) => setDialTarget(e.target.value.toLowerCase())}
                />
              </div>
              <button type="submit" className="dial-call-btn" disabled={!dialTarget.trim()}>
                📞 CALL USER
              </button>
            </form>
          </div>

          {/* Online Peers List */}
          <div className="terminal-card-dark">
            <div className="terminal-card-header">
              <h3>Online Peers</h3>
              <span className="live-count-badge">{otherUsers.length} Online</span>
            </div>

            {otherUsers.length === 0 ? (
              <p className="no-peers-msg">
                No peers online. Share your username <strong>@{currentUser.username || currentUser.id}</strong> to connect!
              </p>
            ) : (
              <div className="peers-scroll-list">
                {otherUsers.map((user) => (
                  <div key={user.userId} className="peer-item-row">
                    <div className="peer-left-meta">
                      <div className="peer-circle-avatar">
                        {user.userName.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="peer-text-meta">
                        <span className="peer-name">{user.userName}</span>
                        <span className="peer-id">@{user.userId}</span>
                      </div>
                    </div>

                    <button
                      className="peer-call-mini"
                      onClick={() => onStartCall(user.userId, user.userName)}
                      title={`Call @${user.userId}`}
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
            <div className="terminal-card-dark">
              <div className="terminal-card-header">
                <h3>Recent Calls</h3>
              </div>
              <div className="recent-calls-list">
                {recentCalls.map((c) => (
                  <div key={c.id} className="recent-call-row">
                    <span>@{c.roomCode}</span>
                    <span className="recent-time">{c.durationSec ? `${c.durationSec}s` : 'Call'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
