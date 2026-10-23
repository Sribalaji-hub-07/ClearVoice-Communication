import { useEffect, useState } from 'react';
import type { CallState, CallInfo, CallStats, ConnectionQuality } from '../types/call';

interface Props {
  role: 'caller' | 'receiver';
  state: CallState;
  callInfo: CallInfo | null;
  isMuted: boolean;
  suppression: number;
  connectionQuality: ConnectionQuality;
  callStats: CallStats | null;
  onToggleMute: () => void;
  onSuppressionChange: (value: number) => void;
  onHangup: () => void;
}

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function getStatusText(state: CallState): string {
  switch (state) {
    case 'calling': return 'Calling...';
    case 'ringing': return 'Ringing...';
    case 'connecting': return 'Connecting...';
    case 'reconnecting': return 'Reconnecting...';
    case 'connected': return 'Connected';
    default: return '';
  }
}

function getQualityColor(q: ConnectionQuality): string {
  switch (q) {
    case 'excellent': return '#22c55e';
    case 'good': return '#84cc16';
    case 'poor': return '#f97316';
    case 'reconnecting': return '#ef4444';
    default: return '#6b7280';
  }
}

function getQualityLabel(q: ConnectionQuality): string {
  switch (q) {
    case 'excellent': return 'Excellent';
    case 'good': return 'Good';
    case 'poor': return 'Poor';
    case 'reconnecting': return 'Reconnecting';
    default: return 'Unknown';
  }
}

function getNoiseLevel(suppression: number): { label: string; color: string } {
  if (suppression === 0) return { label: 'Off', color: '#6b7280' };
  if (suppression < 2) return { label: 'Low', color: '#22c55e' };
  if (suppression < 4) return { label: 'Medium', color: '#eab308' };
  return { label: 'High', color: '#f97316' };
}

export default function InCallView({
  role,
  state,
  callInfo,
  isMuted,
  suppression,
  connectionQuality,
  callStats,
  onToggleMute,
  onSuppressionChange,
  onHangup,
}: Props) {
  const [elapsed, setElapsed] = useState(0);
  const [showNoisePanel, setShowNoisePanel] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const isConnected = state === 'connected';
  const noiseLevel = getNoiseLevel(suppression);

  useEffect(() => {
    if (!isConnected) { setElapsed(0); return; }
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [isConnected]);

  const otherName = role === 'caller'
    ? (callInfo?.receiverName || 'Unknown')
    : (callInfo?.callerName || 'Unknown');

  const initials = otherName.slice(0, 2).toUpperCase();

  return (
    <div className="incall-overlay">
      {/* Background gradient */}
      <div className="incall-bg" />

      {/* Header */}
      <div className="incall-header">
        <div className="incall-header-logo">
          <span className="incall-logo-mark">CV</span>
          <span className="incall-logo-text">ClearVoice</span>
        </div>
        <div className="incall-header-right">
          {isConnected && (
            <button
              className="incall-stats-btn"
              onClick={() => setShowStats(v => !v)}
              title="Connection stats"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 18h4v-8H3v8zm7 0h4V6h-4v12zm7 0h4v-4h-4v4z"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="incall-main">
        {/* Avatar */}
        <div className={`incall-avatar-ring-outer ${isConnected ? 'connected' : 'pulsing'}`}>
          <div className="incall-avatar-ring-inner">
            <div className="incall-avatar-circle">{initials}</div>
          </div>
        </div>

        {/* Name & Status */}
        <div className="incall-identity">
          <h2 className="incall-name">{otherName}</h2>
          <div className="incall-status-row">
            {isConnected ? (
              <>
                <span className="incall-timer">{formatElapsed(elapsed)}</span>
                <span className="incall-dot" />
                <span className="incall-quality-badge" style={{ color: getQualityColor(connectionQuality) }}>
                  {getQualityLabel(connectionQuality)}
                </span>
              </>
            ) : (
              <span className="incall-status-text">{getStatusText(state)}</span>
            )}
          </div>
        </div>

        {/* DSP Active Indicator */}
        <div className="incall-dsp-badge">
          <span className="incall-dsp-dot" />
          <span>Noise Suppression Active</span>
          <span className="incall-dsp-level" style={{ color: noiseLevel.color }}>
            {noiseLevel.label}
          </span>
        </div>

        {/* Stats Panel */}
        {showStats && isConnected && callStats && (
          <div className="incall-stats-panel">
            <div className="incall-stats-row">
              <span>RTT</span><span>{callStats.rtt.toFixed(0)} ms</span>
            </div>
            <div className="incall-stats-row">
              <span>Packet Loss</span><span>{callStats.packetLoss.toFixed(1)}%</span>
            </div>
            <div className="incall-stats-row">
              <span>Jitter</span><span>{callStats.jitter.toFixed(0)} ms</span>
            </div>
            <div className="incall-stats-row">
              <span>Sent</span><span>{(callStats.bytesSent / 1024).toFixed(1)} KB</span>
            </div>
            <div className="incall-stats-row">
              <span>Recv</span><span>{(callStats.bytesReceived / 1024).toFixed(1)} KB</span>
            </div>
          </div>
        )}

        {/* Noise Suppression Slider */}
        {showNoisePanel && (
          <div className="incall-noise-panel">
            <div className="incall-noise-header">
              <span>Noise Suppression</span>
              <span className="incall-noise-value">
                {suppression === 0 ? 'Off' : `${suppression.toFixed(1)}x`}
              </span>
            </div>
            <input
              type="range"
              min={0} max={5} step={0.1}
              value={suppression}
              className="incall-slider"
              onChange={(e) => onSuppressionChange(parseFloat(e.target.value))}
            />
            <div className="incall-noise-labels">
              <span>Off</span><span>Max</span>
            </div>
            <button
              className="incall-noise-done"
              onClick={() => setShowNoisePanel(false)}
            >
              Done
            </button>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="incall-controls-area">
        {/* Secondary controls row */}
        <div className="incall-secondary-controls">
          <button
            className={`incall-ctrl-btn secondary ${showNoisePanel ? 'active' : ''}`}
            onClick={() => setShowNoisePanel(v => !v)}
            title="Noise Suppression"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
            </svg>
            <span>Noise</span>
          </button>

          <button
            className={`incall-ctrl-btn secondary ${isMuted ? 'danger-active' : ''}`}
            onClick={onToggleMute}
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/>
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/>
              </svg>
            )}
            <span>{isMuted ? 'Unmute' : 'Mute'}</span>
          </button>
        </div>

        {/* Hangup Button */}
        <button className="incall-hangup-btn" onClick={onHangup} aria-label="End call">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28-.79-.73-1.68-1.36-2.66-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/>
          </svg>
          <span>End Call</span>
        </button>
      </div>
    </div>
  );
}
