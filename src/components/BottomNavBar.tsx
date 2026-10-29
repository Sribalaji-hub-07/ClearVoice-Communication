export type TabType = 'dashboard' | 'chats' | 'calls' | 'profile' | 'lab';

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
        {/* Dashboard Tab */}
        <button
          className={`nav-tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => onChangeTab('dashboard')}
          aria-label="Dashboard"
          aria-selected={activeTab === 'dashboard'}
          role="tab"
        >
          <div className="nav-tab-icon-wrap">
            <svg className="nav-tab-icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" />
            </svg>
          </div>
          <span className="nav-tab-label">DASHBOARD</span>
        </button>

        {/* Chats Tab */}
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

        {/* Profile Tab */}
        <button
          className={`nav-tab-btn ${activeTab === 'profile' ? 'active' : ''}`}
          onClick={() => onChangeTab('profile')}
          aria-label="Profile"
          aria-selected={activeTab === 'profile'}
          role="tab"
        >
          <div className="nav-tab-icon-wrap">
            <svg className="nav-tab-icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
            </svg>
          </div>
          <span className="nav-tab-label">PROFILE</span>
        </button>

        {/* Lab Tab */}
        <button
          className={`nav-tab-btn ${activeTab === 'lab' ? 'active' : ''}`}
          onClick={() => onChangeTab('lab')}
          aria-label="DSP Lab"
          aria-selected={activeTab === 'lab'}
          role="tab"
        >
          <div className="nav-tab-icon-wrap">
            <svg className="nav-tab-icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M4 19h16v2H4zM6 9h2v8H6zm5-6h2v14h-2zm5 4h2v10h-2z" />
            </svg>
            {isAudioRunning && <span className="nav-badge-dot" title="DSP Running" />}
          </div>
          <span className="nav-tab-label">LAB</span>
        </button>
      </div>
    </nav>
  );
}
