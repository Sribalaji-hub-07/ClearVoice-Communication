import React from 'react';
import type { UserProfile } from '../utils/userAuth';

export type DashboardTab = 'dashboard' | 'calls' | 'chats' | 'lab' | 'profile';

interface Props {
  currentUser: UserProfile;
  activeTab: DashboardTab;
  onSelectTab: (tab: DashboardTab) => void;
  onlineCount: number;
  unreadCount?: number;
}

export default function Sidebar({
  currentUser,
  activeTab,
  onSelectTab,
  onlineCount,
  unreadCount = 0,
}: Props) {
  return (
    <aside className="telemetry-sidebar">
      <div>
        {/* Sidebar Brand Header */}
        <div className="sidebar-header">
          <div className="sidebar-logo-icon">📡</div>
          <div className="sidebar-brand-text">
            <h2>ClearVoice</h2>
            <p>Voice Ops &amp; Site Monitor</p>
          </div>
        </div>

        {/* Menu Label */}
        <div className="sidebar-menu-label">MENU</div>

        {/* Nav items */}
        <nav className="sidebar-nav">
          <button
            className={`sidebar-nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => onSelectTab('dashboard')}
          >
            <span className="nav-icon">📊</span>
            <span>Dashboard</span>
          </button>

          <button
            className={`sidebar-nav-item ${activeTab === 'calls' ? 'active' : ''}`}
            onClick={() => onSelectTab('calls')}
          >
            <span className="nav-icon">📞</span>
            <span>Call Terminal</span>
            {onlineCount > 0 && <span className="nav-badge" style={{ backgroundColor: '#10b981' }}>{onlineCount}</span>}
          </button>

          <button
            className={`sidebar-nav-item ${activeTab === 'chats' ? 'active' : ''}`}
            onClick={() => onSelectTab('chats')}
          >
            <span className="nav-icon">💬</span>
            <span>Secure Chat</span>
            {unreadCount > 0 && <span className="nav-badge">{unreadCount}</span>}
          </button>

          <button
            className={`sidebar-nav-item ${activeTab === 'lab' ? 'active' : ''}`}
            onClick={() => onSelectTab('lab')}
          >
            <span className="nav-icon">🎛️</span>
            <span>DSP Analytics</span>
          </button>

          <button
            className={`sidebar-nav-item ${activeTab === 'profile' ? 'active' : ''}`}
            onClick={() => onSelectTab('profile')}
          >
            <span className="nav-icon">⚙️</span>
            <span>Settings</span>
          </button>
        </nav>
      </div>

      {/* Sidebar Footer with Online Badge */}
      <div className="sidebar-footer">
        <div className="sidebar-status-pill">
          <span className="status-dot-green"></span>
          <span>Online</span>
        </div>
        <div className="sidebar-device-info">
          <div>Terminal ID: #{currentUser.id}</div>
          <div>Polling every 2s</div>
          <div>WebRTC P2P Ready</div>
        </div>
      </div>
    </aside>
  );
}
