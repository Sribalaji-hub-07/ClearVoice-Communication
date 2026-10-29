import React from 'react';

export type TabType = 'chats' | 'calls' | 'directory' | 'dashboard' | 'profile';

interface Props {
  activeTab: TabType;
  onChangeTab: (tab: TabType) => void;
  isAudioRunning: boolean;
  isCallActive: boolean;
  unreadCount?: number;
}

export default function BottomNavBar({
  activeTab,
  onChangeTab,
  isAudioRunning,
  isCallActive,
  unreadCount = 0,
}: Props) {
  return (
    <nav className="bottom-nav-bar" aria-label="Main Navigation">
      <div className="bottom-nav-inner">
        {/* Chats Tab (WhatsApp Style) */}
        <button
          className={`nav-tab-btn ${activeTab === 'chats' ? 'active' : ''}`}
          onClick={() => onChangeTab('chats')}
          aria-label="Chats"
          aria-selected={activeTab === 'chats'}
          role="tab"
        >
          <div className="nav-tab-icon-wrap">
            <svg className="nav-tab-icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z" />
            </svg>
            {unreadCount > 0 && <span className="nav-unread-pill">{unreadCount}</span>}
          </div>
          <span className="nav-tab-label">CHATS</span>
        </button>

        {/* Calls Tab */}
        <button
          className={`nav-tab-btn ${activeTab === 'calls' ? 'active' : ''}`}
          onClick={() => onChangeTab('calls')}
          aria-label="Calls"
          aria-selected={activeTab === 'calls'}
          role="tab"
        >
          <div className="nav-tab-icon-wrap">
            <svg className="nav-tab-icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-2.2 2.2a15.053 15.053 0 01-6.59-6.59l2.2-2.21a.96.96 0 00.25-1.01A11.36 11.36 0 018.5 3.99c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1 0 9.39 7.61 17 17 17 .55 0 1-.45 1-1v-3.61c0-.55-.45-1-.99-1z" />
            </svg>
            {isCallActive && <span className="nav-badge-pulse" />}
          </div>
          <span className="nav-tab-label">CALLS</span>
        </button>

        {/* Directory Tab */}
        <button
          className={`nav-tab-btn ${activeTab === 'directory' ? 'active' : ''}`}
          onClick={() => onChangeTab('directory')}
          aria-label="Directory"
          aria-selected={activeTab === 'directory'}
          role="tab"
        >
          <div className="nav-tab-icon-wrap">
            <svg className="nav-tab-icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
            </svg>
          </div>
          <span className="nav-tab-label">DIRECTORY</span>
        </button>

        {/* Dashboard Voice Equalizer Tab */}
        <button
          className={`nav-tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => onChangeTab('dashboard')}
          aria-label="Voice Ops"
          aria-selected={activeTab === 'dashboard'}
          role="tab"
        >
          <div className="nav-tab-icon-wrap">
            <svg className="nav-tab-icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
            {isAudioRunning && <span className="nav-badge-dot" title="DSP Running" />}
          </div>
          <span className="nav-tab-label">VOICE OPS</span>
        </button>

        {/* Settings / Profile Tab */}
        <button
          className={`nav-tab-btn ${activeTab === 'profile' ? 'active' : ''}`}
          onClick={() => onChangeTab('profile')}
          aria-label="Settings"
          aria-selected={activeTab === 'profile'}
          role="tab"
        >
          <div className="nav-tab-icon-wrap">
            <svg className="nav-tab-icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
            </svg>
          </div>
          <span className="nav-tab-label">SETTINGS</span>
        </button>
      </div>
    </nav>
  );
}
