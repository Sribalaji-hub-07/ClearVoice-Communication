import { useEffect, useState } from 'react';
import type { CallInfo } from '../types/call';

interface Props {
  callInfo: CallInfo;
  onAccept: () => void;
  onReject: () => void;
}

export default function IncomingCall({ callInfo, onAccept, onReject }: Props) {
  const [elapsed, setElapsed] = useState(0);
  const initials = callInfo.callerName.slice(0, 2).toUpperCase();

  useEffect(() => {
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="incoming-overlay">
      <div className="incoming-backdrop" />
      <div className="incoming-card">
        {/* Animated ring */}
        <div className="incoming-ring-anim">
          <div className="incoming-ring r3" />
          <div className="incoming-ring r2" />
          <div className="incoming-ring r1" />
          <div className="incoming-avatar-wrap">
            <div className="incoming-avatar">{initials}</div>
          </div>
        </div>

        {/* Identity */}
        <div className="incoming-identity">
          <p className="incoming-label">Incoming Call</p>
          <h2 className="incoming-name">{callInfo.callerName}</h2>
          <p className="incoming-subtitle">ClearVoice · Noise Suppressed</p>
          {elapsed > 5 && (
            <p className="incoming-timer-hint">Ringing for {elapsed}s…</p>
          )}
        </div>

        {/* Actions */}
        <div className="incoming-actions">
          <div className="incoming-action-wrap">
            <button className="incoming-btn reject" onClick={onReject} aria-label="Reject call">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28-.79-.73-1.68-1.36-2.66-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/>
              </svg>
            </button>
            <span className="incoming-action-label">Decline</span>
          </div>

          <div className="incoming-action-wrap">
            <button className="incoming-btn accept" onClick={onAccept} aria-label="Accept call">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-2.2 2.2a15.053 15.053 0 01-6.59-6.59l2.2-2.21a.96.96 0 00.25-1.01A11.36 11.36 0 018.5 3.99c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1 0 9.39 7.61 17 17 17 .55 0 1-.45 1-1v-3.61c0-.55-.45-1-.99-1z"/>
              </svg>
            </button>
            <span className="incoming-action-label">Accept</span>
          </div>
        </div>
      </div>
    </div>
  );
}
