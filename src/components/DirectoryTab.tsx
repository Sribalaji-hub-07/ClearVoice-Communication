import React, { useState, useEffect } from 'react';
import { fetchUserDirectory, type DirectoryUser, type UserProfile, type ContactInfo } from '../utils/userAuth';
import type { OnlineUser } from '../types/call';

interface Props {
  currentUser: UserProfile;
  onlineUsers: OnlineUser[];
  onStartCall: (targetId: string, targetName: string) => void;
  onStartChat: (contact: ContactInfo) => void;
}

export default function DirectoryTab({
  currentUser,
  onlineUsers,
  onStartCall,
  onStartChat,
}: Props) {
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const loadDirectory = async () => {
    try {
      const serverUsers = await fetchUserDirectory();
      setUsers(serverUsers);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDirectory();
    const interval = setInterval(loadDirectory, 4000);
    return () => clearInterval(interval);
  }, []);

  // Merge live Socket.IO online users with directory list
  const onlineUsernames = new Set(
    onlineUsers.map((u) => u.userId.toLowerCase().replace(/^#/, ''))
  );

  const filtered = users.filter((u) => {
    const q = search.toLowerCase().trim();
    return (
      u.username.toLowerCase().includes(q) ||
      u.name.toLowerCase().includes(q)
    );
  });

  return (
    <div className="directory-view-container">
      {/* Header */}
      <div className="directory-header">
        <div className="directory-header-titles">
          <h2>Peer Directory</h2>
          <p>Find registered users, see live availability, and connect instantly</p>
        </div>
        <button onClick={loadDirectory} className="directory-refresh-btn" title="Refresh Directory">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
          </svg>
          Refresh
        </button>
      </div>

      {/* Search Input Bar */}
      <div className="directory-search-bar">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="#8696a0">
          <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
        </svg>
        <input
          type="text"
          placeholder="Search by username or name (e.g. sribalaji)..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button onClick={() => setSearch('')} className="directory-clear-search">
            ✕
          </button>
        )}
      </div>

      {/* Users List */}
      <div className="directory-list-card">
        {loading && users.length === 0 ? (
          <div className="directory-empty-state">Loading peer directory...</div>
        ) : filtered.length === 0 ? (
          <div className="directory-empty-state">
            {search ? `No peers matching "${search}" found.` : 'No registered peers found.'}
          </div>
        ) : (
          <div className="directory-user-rows">
            {filtered.map((user) => {
              const isSelf = user.username.toLowerCase() === currentUser.username.toLowerCase();
              const isLive = onlineUsernames.has(user.username.toLowerCase()) || user.isOnline;

              return (
                <div key={user.username} className={`directory-user-item ${isSelf ? 'self' : ''}`}>
                  {/* Avatar */}
                  <div className="directory-user-avatar">
                    {user.name.slice(0, 2).toUpperCase()}
                    <span className={`directory-status-indicator ${isLive ? 'online' : 'offline'}`} />
                  </div>

                  {/* Meta */}
                  <div className="directory-user-meta">
                    <div className="directory-name-row">
                      <span className="directory-display-name">{user.name}</span>
                      {isSelf && <span className="directory-self-badge">You</span>}
                    </div>
                    <div className="directory-sub-row">
                      <span className="directory-username">@{user.username}</span>
                      <span className={`directory-status-pill ${isLive ? 'online' : 'offline'}`}>
                        {isLive ? 'Online' : 'Offline'}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  {!isSelf && (
                    <div className="directory-actions">
                      <button
                        className="directory-action-btn chat"
                        onClick={() =>
                          onStartChat({
                            id: user.username,
                            name: user.name,
                            avatarColor: '#00a884',
                            status: isLive ? 'Online' : 'Offline',
                          })
                        }
                        title={`Message @${user.username}`}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z" />
                        </svg>
                        <span>Chat</span>
                      </button>

                      <button
                        className="directory-action-btn call"
                        onClick={() => onStartCall(user.username, user.name)}
                        title={`Call @${user.username}`}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-2.2 2.2a15.053 15.053 0 01-6.59-6.59l2.2-2.21a.96.96 0 00.25-1.01A11.36 11.36 0 018.5 3.99c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1 0 9.39 7.61 17 17 17 .55 0 1-.45 1-1v-3.61c0-.55-.45-1-.99-1z" />
                        </svg>
                        <span>Call</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
