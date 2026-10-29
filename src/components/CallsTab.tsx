import { useState, useEffect } from 'react';
import type { LevelReport } from '../audio/types';
import {
  getRecentCalls,
  deleteRecentCall,
  clearRecentCalls,
  formatRelativeTime,
  formatDuration,
  type CallRecord,
} from '../utils/callHistory';
import type { UserProfile, ContactInfo } from '../utils/userAuth';
import { getOnlineUsers, onOnlineUsersUpdate, requestOnlineUsers } from '../services/socket';
import type { OnlineUser } from '../types/call';

interface Props {
  currentUser: UserProfile;
  canCall: boolean;
  levels: LevelReport | null;
  isAudioRunning: boolean;
  onStartCall: (contactId: string, contactName: string) => Promise<void>;
  onViewContactProfile?: (contact: ContactInfo) => void;
  onHangup: () => void;
  callState: string;
  error: string | null;
}

export default function CallsTab({
  currentUser,
  canCall,
  levels,
  isAudioRunning,
  onStartCall,
  onViewContactProfile,
  error,
}: Props) {
  const [recentCalls, setRecentCalls] = useState<CallRecord[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [showModal, setShowModal] = useState<boolean>(false);
  const [manualUserId, setManualUserId] = useState('');

  const refreshCalls = () => {
    setRecentCalls(getRecentCalls());
  };

  useEffect(() => {
    refreshCalls();
  }, []);

  useEffect(() => {
    setOnlineUsers(getOnlineUsers());
    requestOnlineUsers();
    
    // Subscribe to online users updates
    const handleUpdate = (users: OnlineUser[]) => {
      setOnlineUsers([...users]);
    };
    
    onOnlineUsersUpdate(handleUpdate);

    // Periodically sync online users
    const interval = setInterval(() => {
      requestOnlineUsers();
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  const handleDeleteItem = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    deleteRecentCall(id);
    refreshCalls();
  };

  const handleClearAll = () => {
    if (window.confirm('Clear all recent calls from your device?')) {
      clearRecentCalls();
      refreshCalls();
    }
  };

  const handleQuickRejoin = (contactId: string) => {
    const cleanId = contactId.replace(/^#/, '').trim();
    const user = onlineUsers.find(u => u.userId === cleanId || u.userId === contactId);
    onStartCall(cleanId, user?.userName || `User #${cleanId}`);
  };

  const handleManualCall = () => {
    const input = manualUserId.trim();
    if (!input) return;
    const cleanId = input.replace(/^#/, '').trim();
    const matched = onlineUsers.find(
      u => u.userId === cleanId || 
           u.userId === input || 
           u.userName.toLowerCase() === input.toLowerCase()
    );
    const targetId = matched ? matched.userId : cleanId;
    const targetName = matched ? matched.userName : `User #${cleanId}`;

    setShowModal(false);
    setManualUserId('');
    onStartCall(targetId, targetName);
  };

  // Filter out the current user from online list
  const otherOnlineUsers = onlineUsers.filter(u => u.userId !== currentUser.id);

  return (
    <div className="tab-pane calls-tab">
      {/* Mic Status & Live Audio Indicator */}
      <div className="calls-status-card">
        <div className="calls-status-left">
          <div className={`status-pulse-dot ${isAudioRunning ? 'live' : ''}`} />
          <div>
            <div className="calls-status-title">
              {isAudioRunning ? 'DSP NOISE ENGINE ACTIVE ⚡' : 'MICROPHONE STANDBY'}
            </div>
            <div className="calls-status-subtitle">
              {isAudioRunning
                ? 'Adaptive spectral subtraction running in AudioWorklet'
                : `Signed in as ${currentUser.name} (#${currentUser.id})`}
            </div>
          </div>
        </div>
        {isAudioRunning && (
          <div className="calls-mini-meter-wrap">
            <span className="calls-mini-meter-label">MIC</span>
            <div className="calls-mini-meter-track">
              <div
                className="calls-mini-meter-fill"
                style={{ width: `${Math.min(100, (levels?.inputLevel ?? 0) * 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {error && <div className="error-banner" style={{ margin: '14px 0' }}>{error}</div>}

      {/* Online Users List */}
      <div className="online-users-section" style={{ marginBottom: '24px' }}>
        <div className="recent-calls-header">
          <h3>ONLINE USERS ({otherOnlineUsers.length})</h3>
        </div>
        
        {otherOnlineUsers.length === 0 ? (
          <div className="empty-calls-state" style={{ padding: '20px' }}>
            <p>No other users are currently online.</p>
          </div>
        ) : (
          <div className="recent-calls-list">
            {otherOnlineUsers.map((user) => (
              <div key={user.userId} className="recent-call-item" onClick={() => onStartCall(user.userId, user.userName)}>
                <div 
                  className="call-avatar-circle" 
                  style={{ background: 'var(--accent-green, #4ade80)' }}
                  onClick={(e) => {
                    if (onViewContactProfile) {
                      e.stopPropagation();
                      onViewContactProfile({
                        id: user.userId,
                        name: user.userName,
                        email: `${user.userId}@clearvoice.app`,
                        status: 'Online',
                        avatarColor: '#4ade80',
                      });
                    }
                  }}
                >
                  <span className="call-avatar-text">{user.userName.substring(0, 2).toUpperCase()}</span>
                </div>
                
                <div className="call-item-details">
                  <div className="call-item-title-row">
                    <span className="call-room-code">{user.userName}</span>
                  </div>
                  <div className="call-item-meta-row">
                    <span className="call-type-tag" style={{ color: 'var(--accent-green, #4ade80)' }}>
                      ● ONLINE
                    </span>
                    <span className="call-duration-tag">
                      · #{user.userId}
                    </span>
                  </div>
                </div>

                <div className="call-item-actions">
                  <button
                    className="btn btn-primary"
                    style={{ padding: '6px 12px', fontSize: '12px' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onStartCall(user.userId, user.userName);
                    }}
                    disabled={!canCall}
                  >
                    CALL
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Calls Section */}
      <div className="recent-calls-section">
        <div className="recent-calls-header">
          <h3>RECENT CALLS</h3>
          {recentCalls.length > 0 && (
            <button className="clear-history-btn" onClick={handleClearAll}>
              CLEAR ALL
            </button>
          )}
        </div>

        {recentCalls.length === 0 ? (
          <div className="empty-calls-state">
            <div className="empty-calls-icon">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-2.2 2.2a15.053 15.053 0 01-6.59-6.59l2.2-2.21a.96.96 0 00.25-1.01A11.36 11.36 0 018.5 3.99c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1 0 9.39 7.61 17 17 17 .55 0 1-.45 1-1v-3.61c0-.55-.45-1-.99-1z" />
              </svg>
            </div>
            <h4>NO CALLS LOGGED</h4>
            <p>
              Calls you make are saved locally on this device for instant 1-tap redialing.
            </p>
          </div>
        ) : (
          <div className="recent-calls-list">
            {recentCalls.map((call) => (
              <div
                key={call.id}
                className="recent-call-item"
                onClick={() => handleQuickRejoin(call.roomCode)}
              >
                {/* Avatar / Direction Icon */}
                <div
                  className="call-avatar-circle"
                  onClick={(e) => {
                    if (onViewContactProfile) {
                      e.stopPropagation();
                      onViewContactProfile({
                        id: call.roomCode,
                        name: `User #${call.roomCode}`,
                        email: `${call.roomCode}@clearvoice.app`,
                        status: 'ClearVoice Peer',
                        avatarColor: '#FFE600',
                      });
                    }
                  }}
                  title="View Profile"
                >
                  <span className="call-avatar-text">{call.roomCode.substring(0, 2).toUpperCase()}</span>
                  <div className={`call-dir-badge ${call.role}`}>
                    {call.role === 'caller' ? (
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M9 5v2h6.59L4 18.59 5.41 20 17 8.41V15h2V5z" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M20 5.41L18.59 4 7 15.59V9H5v10h10v-2H8.41z" />
                      </svg>
                    )}
                  </div>
                </div>

                {/* Call Info */}
                <div className="call-item-details">
                  <div className="call-item-title-row">
                    <span className="call-room-code">User #{call.roomCode}</span>
                    <span className="call-time">{formatRelativeTime(call.timestamp)}</span>
                  </div>
                  <div className="call-item-meta-row">
                    <span className="call-type-tag">
                      {call.role === 'caller' ? '↗ OUTGOING' : '↙ INCOMING'}
                    </span>
                    {call.durationSec > 0 && (
                      <span className="call-duration-tag">
                        · {formatDuration(call.durationSec)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Action Button & Delete */}
                <div className="call-item-actions">
                  <button
                    className="call-redial-btn"
                    title="Call this user"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleQuickRejoin(call.roomCode);
                    }}
                    disabled={!canCall}
                    aria-label={`Call user ${call.roomCode}`}
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-2.2 2.2a15.053 15.053 0 01-6.59-6.59l2.2-2.21a.96.96 0 00.25-1.01A11.36 11.36 0 018.5 3.99c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1 0 9.39 7.61 17 17 17 .55 0 1-.45 1-1v-3.61c0-.55-.45-1-.99-1z" />
                    </svg>
                  </button>
                  <button
                    className="call-delete-btn"
                    title="Remove from history"
                    onClick={(e) => handleDeleteItem(e, call.id)}
                    aria-label="Delete call record"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Neo-Brutalist Floating Action Button */}
      <button
        className="whatsapp-fab"
        onClick={() => setShowModal(true)}
        disabled={!canCall}
        title="Start a new call manually"
        aria-label="Start a new call manually"
      >
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-2.2 2.2a15.053 15.053 0 01-6.59-6.59l2.2-2.21a.96.96 0 00.25-1.01A11.36 11.36 0 018.5 3.99c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1 0 9.39 7.61 17 17 17 .55 0 1-.45 1-1v-3.61c0-.55-.45-1-.99-1z" />
        </svg>
      </button>

      {/* Modal: Start Call Manually */}
      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>START NEW CALL</h3>
              <button className="modal-close-btn" onClick={() => setShowModal(false)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-desc">
                Enter the username of the user you want to call.
              </p>
              <div style={{ fontSize: '13px', color: '#94a3b8', margin: '6px 0 12px 0' }}>
                Your username is: <strong style={{ color: '#00a884', fontSize: '15px' }}>@{currentUser.username || currentUser.id}</strong>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '14px 0' }}>
                <input
                  type="text"
                  value={manualUserId}
                  onChange={(e) => setManualUserId(e.target.value.toLowerCase())}
                  placeholder="Enter username (e.g. sribalaji)"
                  style={{
                    padding: '12px',
                    fontSize: '16px',
                    border: '1px solid #202c33',
                    borderRadius: '8px',
                    backgroundColor: '#111b21',
                    color: '#e9edef',
                    outline: 'none',
                    fontFamily: 'monospace'
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleManualCall();
                  }}
                />
              </div>

              <div className="modal-actions-row">
                <button
                  className="btn btn-primary"
                  onClick={handleManualCall}
                  disabled={!manualUserId.trim()}
                >
                  CALL USER ⚡
                </button>
                <button
                  className="btn"
                  onClick={() => setShowModal(false)}
                >
                  CANCEL
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
