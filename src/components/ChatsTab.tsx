import React, { useState, useEffect, useRef } from 'react';
import {
  getChatThreads,
  getMessagesForContact,
  saveMessage,
  saveChatThread,
  markThreadRead,
  type ChatThread,
  type ChatMessage,
} from '../utils/chatStorage';
import { type UserProfile, type ContactInfo, fetchUserDirectory, saveContact } from '../utils/userAuth';
import * as socketService from '../services/socket';
import type { ChatPeerManager } from '../p2p/chatPeer';

interface Props {
  currentUser: UserProfile;
  activeContact: ContactInfo | null;
  onSelectContact: (contact: ContactInfo | null) => void;
  onViewContactProfile: (contact: ContactInfo) => void;
  onStartCall: (contactId: string, contactName: string) => Promise<void>;
  chatPeer: ChatPeerManager | null;
  onlinePeers: Set<string>;
  p2pMsgTrigger: number;
}

export default function ChatsTab({
  currentUser,
  activeContact,
  onSelectContact,
  onStartCall,
  chatPeer,
  onlinePeers,
  p2pMsgTrigger,
}: Props) {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'unread' | 'favorites'>('all');
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newChatError, setNewChatError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const refreshThreads = () => {
    setThreads(getChatThreads());
  };

  useEffect(() => {
    refreshThreads();
  }, []);

  // When active contact changes, load messages and mark thread read
  useEffect(() => {
    if (activeContact) {
      setMessages(getMessagesForContact(activeContact.id));
      markThreadRead(activeContact.id);
      refreshThreads();
      scrollToBottom();
    }
  }, [activeContact]);

  // Handle incoming socket real-time messages
  useEffect(() => {
    const unsubscribe = socketService.onReceiveChatMessage((incoming) => {
      console.log('[CHAT-UI] Received message from socket:', incoming);
      saveMessage(incoming.senderId, {
        senderId: incoming.senderId,
        receiverId: incoming.receiverId,
        text: incoming.text,
        timestamp: incoming.timestamp,
        status: 'delivered',
      });

      refreshThreads();
      if (activeContact && (activeContact.id === incoming.senderId || activeContact.id === incoming.receiverId)) {
        setMessages(getMessagesForContact(activeContact.id));
        scrollToBottom();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [activeContact]);

  // Sync when p2p trigger updates
  useEffect(() => {
    if (p2pMsgTrigger === 0) return;
    refreshThreads();
    if (activeContact) {
      setMessages(getMessagesForContact(activeContact.id));
      markThreadRead(activeContact.id);
      scrollToBottom();
    }
  }, [p2pMsgTrigger, activeContact]);

  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = inputText.trim();
    if (!text || !activeContact) return;

    const timestamp = Date.now();
    const cleanReceiver = activeContact.id.toLowerCase().replace(/^#/, '');

    // 1. Save locally
    const newMsg = saveMessage(activeContact.id, {
      senderId: currentUser.username || currentUser.id,
      receiverId: cleanReceiver,
      text,
      timestamp,
      status: 'sent',
    });

    setMessages((prev) => [...prev, newMsg]);
    setInputText('');
    refreshThreads();
    scrollToBottom();

    // 2. Broadcast via Socket.IO
    socketService.emitSendChatMessage({
      id: newMsg.id,
      senderId: currentUser.username || currentUser.id,
      senderName: currentUser.name,
      receiverId: cleanReceiver,
      text,
      timestamp,
    });

    // 3. Fallback/P2P via WebRTC DataChannel
    if (chatPeer && cleanReceiver !== 'echo_bot') {
      try {
        await chatPeer.sendMessage(cleanReceiver, text);
      } catch (err) {
        console.warn('P2P data channel skipped:', err);
      }
    }

    // Echo bot simulation
    if (cleanReceiver === 'echo_bot') {
      setTimeout(() => {
        const botReply = saveMessage(activeContact.id, {
          senderId: 'echo_bot',
          receiverId: currentUser.username || currentUser.id,
          text: `Echo: "${text}" · (Microphone & DSP ready)`,
          timestamp: Date.now(),
          status: 'delivered',
        });
        setMessages((prev) => [...prev, botReply]);
        refreshThreads();
        scrollToBottom();
      }, 700);
    }
  };

  const handleStartNewChat = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUser = newUsername.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!cleanUser) {
      setNewChatError('Please enter a username.');
      return;
    }
    if (cleanUser === (currentUser.username || currentUser.id).toLowerCase()) {
      setNewChatError('You cannot start a chat with yourself.');
      return;
    }

    // Lookup user in server directory
    const dir = await fetchUserDirectory();
    const matched = dir.find((u) => u.username.toLowerCase() === cleanUser);
    const targetName = matched ? matched.name : `@${cleanUser}`;

    const newContact: ContactInfo = {
      id: cleanUser,
      name: targetName,
      status: matched?.isOnline ? 'Online' : 'Offline',
      avatarColor: matched?.avatarColor || '#00a884',
    };

    saveContact(newContact);
    saveChatThread({
      contactId: cleanUser,
      contactName: targetName,
      avatarColor: newContact.avatarColor,
      lastMessage: 'Tap here to chat',
      lastTimestamp: Date.now(),
      unreadCount: 0,
    });

    onSelectContact(newContact);
    setShowNewChatModal(false);
    setNewUsername('');
    setNewChatError(null);
    refreshThreads();
  };

  const isContactOnline = (contactId: string): boolean => {
    const clean = contactId.toLowerCase().replace(/^#/, '');
    return onlinePeers.has(clean) || onlinePeers.has(contactId);
  };

  const formatMessageTime = (ts: number): string => {
    const date = new Date(ts);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const filteredThreads = threads.filter((t) => {
    const matchesSearch =
      t.contactName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.contactId.toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;
    if (filterMode === 'unread') return t.unreadCount > 0;
    return true;
  });

  return (
    <div className="wa-chat-container">
      {/* ── Left Chats List Pane ── */}
      <aside className="wa-chats-sidebar">
        {/* Top Header */}
        <div className="wa-sidebar-header">
          <h2 className="wa-sidebar-title">Chats</h2>
          <div className="wa-header-actions">
            <button
              className="wa-icon-btn"
              onClick={() => setShowNewChatModal(true)}
              title="New Chat"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="wa-search-wrapper">
          <div className="wa-search-input-box">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#8696a0">
              <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
            </svg>
            <input
              type="text"
              placeholder="Search or start a new chat"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Category Filter Pills (All / Unread / Favourites) */}
        <div className="wa-filter-chips">
          <button
            className={`wa-chip-btn ${filterMode === 'all' ? 'active' : ''}`}
            onClick={() => setFilterMode('all')}
          >
            All
          </button>
          <button
            className={`wa-chip-btn ${filterMode === 'unread' ? 'active' : ''}`}
            onClick={() => setFilterMode('unread')}
          >
            Unread
          </button>
          <button
            className={`wa-chip-btn ${filterMode === 'favorites' ? 'active' : ''}`}
            onClick={() => setFilterMode('favorites')}
          >
            Favourites
          </button>
        </div>

        {/* Chat List */}
        <div className="wa-threads-scroll">
          {filteredThreads.length === 0 ? (
            <div className="wa-no-chats-hint">
              <p>No conversations yet.</p>
              <button
                className="wa-start-chat-btn"
                onClick={() => setShowNewChatModal(true)}
              >
                + Start a New Chat
              </button>
            </div>
          ) : (
            filteredThreads.map((thread) => {
              const isSelected = activeContact?.id === thread.contactId;
              const isLive = isContactOnline(thread.contactId);

              return (
                <div
                  key={thread.contactId}
                  className={`wa-thread-row ${isSelected ? 'selected' : ''}`}
                  onClick={() =>
                    onSelectContact({
                      id: thread.contactId,
                      name: thread.contactName,
                      avatarColor: thread.avatarColor || '#00a884',
                      status: isLive ? 'Online' : 'Offline',
                    })
                  }
                >
                  {/* Avatar */}
                  <div className="wa-thread-avatar">
                    {thread.contactName.slice(0, 2).toUpperCase()}
                    {isLive && <span className="wa-online-dot" />}
                  </div>

                  {/* Info */}
                  <div className="wa-thread-content">
                    <div className="wa-thread-top">
                      <span className="wa-thread-name">{thread.contactName}</span>
                      <span className="wa-thread-time">
                        {thread.lastTimestamp ? formatMessageTime(thread.lastTimestamp) : ''}
                      </span>
                    </div>

                    <div className="wa-thread-bottom">
                      <span className="wa-thread-snippet">
                        <span className="wa-check-icon">✓✓</span> {thread.lastMessage || 'No messages yet'}
                      </span>
                      {thread.unreadCount > 0 && (
                        <span className="wa-unread-badge">{thread.unreadCount}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* ── Right Main Conversation Window ── */}
      {activeContact ? (
        <main className="wa-convo-panel">
          {/* Conversation Top Header */}
          <header className="wa-convo-header">
            <div className="wa-convo-contact-info">
              <div className="wa-convo-avatar">
                {activeContact.name.slice(0, 2).toUpperCase()}
              </div>
              <div className="wa-convo-names">
                <h3>{activeContact.name}</h3>
                <span className="wa-convo-status">
                  {isContactOnline(activeContact.id) ? (
                    <strong style={{ color: '#00a884' }}>online</strong>
                  ) : (
                    `@${activeContact.id}`
                  )}
                </span>
              </div>
            </div>

            {/* Calling & Search Actions */}
            <div className="wa-convo-actions">
              <button
                className="wa-convo-action-btn"
                onClick={() => onStartCall(activeContact.id, activeContact.name)}
                title="Voice Call"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-2.2 2.2a15.053 15.053 0 01-6.59-6.59l2.2-2.21a.96.96 0 00.25-1.01A11.36 11.36 0 018.5 3.99c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1 0 9.39 7.61 17 17 17 .55 0 1-.45 1-1v-3.61c0-.55-.45-1-.99-1z" />
                </svg>
              </button>

              <button
                className="wa-convo-action-btn"
                onClick={() => onStartCall(activeContact.id, activeContact.name)}
                title="Video / Audio Call"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
                </svg>
              </button>
            </div>
          </header>

          {/* Messages Stream with WhatsApp Dark Wallpaper Background */}
          <div className="wa-messages-viewport">
            <div className="wa-date-divider-pill">
              <span>TODAY</span>
            </div>

            <div className="wa-bubble-flow">
              {messages.map((msg) => {
                const isMe = msg.senderId === (currentUser.username || currentUser.id);

                return (
                  <div key={msg.id} className={`wa-bubble-row ${isMe ? 'sent' : 'received'}`}>
                    <div className="wa-bubble-card">
                      <p className="wa-bubble-text">{msg.text}</p>
                      <div className="wa-bubble-meta">
                        <span className="wa-bubble-time">{formatMessageTime(msg.timestamp)}</span>
                        {isMe && (
                          <span className="wa-double-check" title="Delivered">
                            ✓✓
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Bottom Message Input Bar */}
          <footer className="wa-chat-input-bar">
            <button className="wa-input-icon-btn" title="Emoji">
              😊
            </button>
            <button className="wa-input-icon-btn" title="Attach file">
              📎
            </button>

            <form onSubmit={handleSendMessage} className="wa-input-form">
              <input
                type="text"
                placeholder="Type a message"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                autoFocus
              />
              <button
                type="submit"
                className="wa-send-submit-btn"
                disabled={!inputText.trim()}
                title="Send"
              >
                {inputText.trim() ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" />
                  </svg>
                )}
              </button>
            </form>
          </footer>
        </main>
      ) : (
        <main className="wa-empty-convo-panel">
          <div className="wa-empty-prompt-card">
            <div className="wa-empty-icon">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="#00a884">
                <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z" />
              </svg>
            </div>
            <h2>ClearVoice Web</h2>
            <p>
              Send and receive messages with peer-to-peer security. Select a chat or search for a
              username to start messaging.
            </p>
            <button
              onClick={() => setShowNewChatModal(true)}
              className="wa-new-chat-hero-btn"
            >
              Start New Chat
            </button>
          </div>
        </main>
      )}

      {/* ── New Chat Modal ── */}
      {showNewChatModal && (
        <div className="wa-modal-overlay">
          <div className="wa-modal-card">
            <div className="wa-modal-header">
              <h3>Start New Chat</h3>
              <button
                className="wa-modal-close-btn"
                onClick={() => {
                  setShowNewChatModal(false);
                  setNewChatError(null);
                }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleStartNewChat} className="wa-modal-form">
              <label>Recipient Username</label>
              <div className="wa-modal-input-wrap">
                <span>@</span>
                <input
                  type="text"
                  placeholder="e.g. sribalaji"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value.toLowerCase())}
                  autoFocus
                />
              </div>

              {newChatError && <div className="wa-modal-error">{newChatError}</div>}

              <div className="wa-modal-footer">
                <button
                  type="button"
                  className="wa-modal-cancel"
                  onClick={() => setShowNewChatModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="wa-modal-submit">
                  Open Chat
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
