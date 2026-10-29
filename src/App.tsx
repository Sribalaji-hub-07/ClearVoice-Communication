import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioEngine } from './audio/audioEngine';
import { AudioRecorder, type RecordingResult } from './audio/recorder';
import type { LevelReport, MicPermissionState, MonitorMode, ProcessingState } from './audio/types';

import InCallView from './components/InCallView';
import BottomNavBar, { type TabType } from './components/BottomNavBar';
import ChatsTab from './components/ChatsTab';
import CallsTab from './components/CallsTab';
import DirectoryTab from './components/DirectoryTab';
import DashboardView from './components/DashboardView';
import ProfileTab from './components/ProfileTab';
import AuthLanding from './components/AuthLanding';
import SignUpPage from './components/SignUpPage';
import LoginPage from './components/LoginPage';
import ContactProfileModal from './components/ContactProfileModal';
import SplashScreen from './components/SplashScreen';
import IncomingCall from './components/IncomingCall';
import MicPermissionModal from './components/MicPermissionModal';
import type { OnlineUser } from './types/call';

import { getCurrentUser, logoutUser, type UserProfile, type ContactInfo } from './utils/userAuth';
import { getSettings, type AppSettings } from './utils/settingsStorage';
import { ChatPeerManager, type P2PMessage } from './p2p/chatPeer';
import { saveMessage, saveChatThread, getChatThreads } from './utils/chatStorage';

import { useCall } from './hooks/useCall';
import * as socketService from './services/socket';

type AuthView = 'landing' | 'signup' | 'login';

export default function App() {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(() => getCurrentUser());
  const [authView, setAuthView] = useState<AuthView>('landing');
  const [activeTab, setActiveTab] = useState<TabType>('chats');
  const [activeChatContact, setActiveChatContact] = useState<ContactInfo | null>(null);
  const [viewingContact, setViewingContact] = useState<ContactInfo | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);

  const [settings, setSettings] = useState<AppSettings>(getSettings());
  const [suppression, setSuppression] = useState(settings.defaultSuppression);

  // Sync online users list
  useEffect(() => {
    setOnlineUsers(socketService.getOnlineUsers());
    socketService.requestOnlineUsers();

    const handleUsersUpdate = (users: OnlineUser[]) => {
      setOnlineUsers([...users]);
    };

    socketService.onOnlineUsersUpdate(handleUsersUpdate);
    const syncInterval = setInterval(() => {
      socketService.requestOnlineUsers();
    }, 10000);

    return () => clearInterval(syncInterval);
  }, []);

  // Socket.IO Connection
  useEffect(() => {
    const userIdentifier = currentUser?.username || currentUser?.id;
    if (userIdentifier && currentUser?.name) {
      socketService.connectSocket(userIdentifier, currentUser.name);
    }
    return () => {
      socketService.disconnectSocket();
    };
  }, [currentUser?.username, currentUser?.id, currentUser?.name]);

  const call = useCall(currentUser?.username || currentUser?.id || '', currentUser?.name || '');

  // P2P Chat State
  const [chatPeer, setChatPeer] = useState<ChatPeerManager | null>(null);
  const [onlinePeers, setOnlinePeers] = useState<Set<string>>(new Set());
  const [, setIsP2PConnected] = useState(false);
  const [p2pMsgTrigger, setP2pMsgTrigger] = useState(0);

  const incomingMsgHandlerRef = useRef<(msg: P2PMessage) => void>(() => {});
  const activeChatContactRef = useRef<ContactInfo | null>(null);

  useEffect(() => {
    activeChatContactRef.current = activeChatContact;
  }, [activeChatContact]);

  useEffect(() => {
    incomingMsgHandlerRef.current = (msg: P2PMessage) => {
      if (currentUser) {
        saveMessage(msg.senderId, {
          senderId: msg.senderId,
          receiverId: currentUser.username || currentUser.id || '',
          text: msg.text || '',
          timestamp: msg.timestamp || Date.now(),
          status: 'delivered',
        });

        const threads = getChatThreads();
        const existing = threads.find((t) => t.contactId === msg.senderId);
        if (!existing) {
          saveChatThread({
            contactId: msg.senderId,
            contactName: msg.senderName || `@${msg.senderId}`,
            contactStatus: 'ClearVoice Peer',
            avatarColor: '#00a884',
            lastMessage: msg.text || '',
            lastTimestamp: msg.timestamp || Date.now(),
            unreadCount: 1,
          });
        } else {
          saveChatThread({
            ...existing,
            lastMessage: msg.text || '',
            lastTimestamp: msg.timestamp || Date.now(),
            unreadCount:
              activeChatContactRef.current?.id === msg.senderId
                ? 0
                : existing.unreadCount + 1,
          });
        }

        setP2pMsgTrigger((prev) => prev + 1);
      }
    };
  }, [currentUser?.username, currentUser?.id]);

  useEffect(() => {
    const userId = currentUser?.username || currentUser?.id;
    if (!userId || !currentUser) {
      setChatPeer(null);
      setIsP2PConnected(false);
      return;
    }

    const peer = new ChatPeerManager(userId, currentUser.name, {
      onMessage: (msg) => incomingMsgHandlerRef.current(msg),
      onPeerOnline: (peerId) => {
        setOnlinePeers((prev) => new Set(prev).add(peerId));
      },
      onPeerOffline: (peerId) => {
        setOnlinePeers((prev) => {
          const next = new Set(prev);
          next.delete(peerId);
          return next;
        });
      },
      onConnectionStateChange: (state) => {
        setIsP2PConnected(state === 'connected');
      },
      onError: (errMsg) => {
        console.error('ChatPeer error:', errMsg);
      },
    });

    peer.connect().catch((err) => {
      console.warn('ChatPeer connect error:', err);
    });

    setChatPeer(peer);

    return () => {
      peer.disconnect();
    };
  }, [currentUser?.username, currentUser?.id, currentUser?.name]);

  // Audio Engine State
  const [isRunning, setIsRunning] = useState(false);
  const [micPermission, setMicPermission] = useState<MicPermissionState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [levels, setLevels] = useState<LevelReport | null>(null);
  const [analysers, setAnalysers] = useState<{
    original: AnalyserNode | null;
    enhanced: AnalyserNode | null;
  }>({ original: null, enhanced: null });
  const [monitorMode, setMonitorMode] = useState<MonitorMode>('none');
  const [isRecording, setIsRecording] = useState(false);
  const [, setRecordings] = useState<RecordingResult[]>([]);

  const engineRef = useRef<AudioEngine | null>(null);
  const recorderRef = useRef<AudioRecorder>(new AudioRecorder());
  const isCallActive = call.callState !== 'idle';

  const handleStart = useCallback(async (): Promise<boolean> => {
    setMicPermission('requesting');
    setError(null);
    const engine = new AudioEngine();
    engineRef.current = engine;

    const ok = await engine.start();
    if (ok) {
      setMicPermission('granted');
      setIsRunning(true);
      setAnalysers(engine.analysers);
      engine.setSuppressionAmount(suppression);
      engine.setMonitorMode(monitorMode);
    } else {
      setIsRunning(false);
      setAnalysers({ original: null, enhanced: null });
    }
    return ok;
  }, [suppression, monitorMode]);

  const ensureProcessingRunning = useCallback(async (): Promise<boolean> => {
    if (engineRef.current) return true;
    return handleStart();
  }, [handleStart]);

  const handleStop = useCallback(() => {
    if (isRecording) {
      recorderRef.current.stop();
      setIsRecording(false);
    }
    if (isCallActive) {
      call.endCall();
    }
    engineRef.current?.stop();
    engineRef.current = null;
    setIsRunning(false);
    setAnalysers({ original: null, enhanced: null });
    setLevels(null);
  }, [isRecording, isCallActive, call]);

  const handleCloseMicModal = useCallback(() => {
    setMicPermission('idle');
    if (micPermission === 'denied') {
      setError(null);
    }
  }, [micPermission]);

  const handleSuppressionChange = useCallback((value: number) => {
    setSuppression(value);
    engineRef.current?.setSuppressionAmount(value);
  }, []);

  const getAudioStreamForCall = async (): Promise<MediaStream | null> => {
    try {
      const ready = await ensureProcessingRunning();
      if (ready && engineRef.current?.callStream) {
        return engineRef.current.callStream;
      }
    } catch (e) {
      console.warn('[AUDIO] AudioEngine could not be initialized, using fallback mic:', e);
    }

    try {
      const fallbackStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      setMicPermission('granted');
      return fallbackStream;
    } catch (err) {
      console.error('[AUDIO] Direct mic access failed:', err);
      setMicPermission('denied');
      setError('Microphone permission is required to place or accept calls.');
      return null;
    }
  };

  const handleStartCall = async (receiverId: string, receiverName: string) => {
    const stream = await getAudioStreamForCall();
    if (!stream) {
      alert('Microphone access is required to place calls. Please allow microphone permissions.');
      return;
    }
    call.startCall(receiverId, receiverName, stream);
  };

  const handleAcceptCall = async () => {
    const stream = await getAudioStreamForCall();
    if (!stream) {
      alert('Microphone access is required to accept this call.');
      call.rejectCall('Microphone not available');
      return;
    }
    call.acceptCall(stream);
  };

  const handleLogout = () => {
    if (window.confirm('Are you sure you want to log out of ClearVoice?')) {
      handleStop();
      chatPeer?.disconnect();
      setChatPeer(null);
      logoutUser();
      setCurrentUser(null);
      setAuthView('landing');
    }
  };

  const handleStartChatWithContact = (contact: ContactInfo) => {
    setActiveTab('chats');
    setActiveChatContact(contact);
  };

  const handleAuthSuccess = (user: UserProfile) => {
    setCurrentUser(user);
    setActiveTab('chats');
  };

  return (
    <div className="app-container-dark">
      {/* Splash Screen */}
      <SplashScreen />

      {/* Auth Screens */}
      {!currentUser && authView === 'landing' && (
        <AuthLanding
          onGoToSignUp={() => setAuthView('signup')}
          onGoToLogin={() => setAuthView('login')}
        />
      )}
      {!currentUser && authView === 'signup' && (
        <SignUpPage
          onSuccess={handleAuthSuccess}
          onGoToLogin={() => setAuthView('login')}
        />
      )}
      {!currentUser && authView === 'login' && (
        <LoginPage
          onSuccess={handleAuthSuccess}
          onGoToSignUp={() => setAuthView('signup')}
        />
      )}

      {/* ── Main Fullscreen Content Layout (No Wide Sidebar) ── */}
      {currentUser && (
        <div className="app-main-layout">
          {activeTab === 'chats' && (
            <main className="tab-fullscreen-pane">
              <ChatsTab
                currentUser={currentUser}
                activeContact={activeChatContact}
                onSelectContact={setActiveChatContact}
                onViewContactProfile={setViewingContact}
                onStartCall={handleStartCall}
                chatPeer={chatPeer}
                onlinePeers={onlinePeers}
                p2pMsgTrigger={p2pMsgTrigger}
              />
            </main>
          )}

          {activeTab === 'calls' && (
            <main className="tab-fullscreen-pane">
              <CallsTab
                currentUser={currentUser}
                canCall={micPermission !== 'denied'}
                callState={call.callState}
                levels={levels}
                isAudioRunning={isRunning}
                onStartCall={handleStartCall}
                onHangup={call.endCall}
                onViewContactProfile={setViewingContact}
                error={error}
              />
            </main>
          )}

          {activeTab === 'directory' && (
            <main className="tab-fullscreen-pane">
              <DirectoryTab
                currentUser={currentUser}
                onlineUsers={onlineUsers}
                onStartCall={handleStartCall}
                onStartChat={handleStartChatWithContact}
              />
            </main>
          )}

          {activeTab === 'dashboard' && (
            <main className="tab-fullscreen-pane">
              <DashboardView
                currentUser={currentUser}
                levels={levels}
                analysers={analysers}
                isAudioRunning={isRunning}
                suppression={suppression}
                onSuppressionChange={handleSuppressionChange}
                onlineUsers={onlineUsers}
                callState={call.callState}
                callStats={call.callStats}
                onStartCall={handleStartCall}
                onHangup={call.endCall}
                onViewContactProfile={setViewingContact}
                onStartAudio={handleStart}
                onStopAudio={handleStop}
              />
            </main>
          )}

          {activeTab === 'profile' && (
            <main className="tab-fullscreen-pane">
              <ProfileTab
                currentUser={currentUser}
                settings={settings}
                suppression={suppression}
                onUpdateUser={setCurrentUser}
                onSuppressionChange={handleSuppressionChange}
                onSettingsChange={setSettings}
                onLogout={handleLogout}
              />
            </main>
          )}
        </div>
      )}

      {/* Bottom Navigation Bar */}
      {currentUser && (
        <BottomNavBar
          activeTab={activeTab}
          onChangeTab={setActiveTab}
          unreadCount={0}
          isAudioRunning={isRunning}
          isCallActive={isCallActive}
        />
      )}

      {/* Contact Profile Modal */}
      {viewingContact && (
        <ContactProfileModal
          contact={viewingContact}
          onClose={() => setViewingContact(null)}
          onStartChat={handleStartChatWithContact}
          onStartCall={(id: string, name?: string) => handleStartCall(id, name ?? `@${id}`)}
        />
      )}

      {/* Incoming Call Overlay */}
      {call.callState === 'ringing' && call.callInfo && (
        <IncomingCall
          callInfo={call.callInfo}
          onAccept={handleAcceptCall}
          onReject={call.rejectCall}
        />
      )}

      {/* In-Call View */}
      {call.callState !== 'idle' && call.callState !== 'ringing' && (
        <InCallView
          role={call.callInfo?.callerId === (currentUser?.username || currentUser?.id) ? 'caller' : 'receiver'}
          state={call.callState}
          callInfo={call.callInfo}
          connectionQuality={call.connectionQuality}
          callStats={call.callStats}
          isMuted={call.isMuted}
          suppression={suppression}
          onToggleMute={call.toggleMute}
          onSuppressionChange={handleSuppressionChange}
          onHangup={call.endCall}
        />
      )}

      {/* Mic Permission Modal */}
      {(micPermission === 'requesting' || micPermission === 'denied') && !isRunning && (
        <MicPermissionModal
          permissionState={micPermission}
          error={micPermission === 'denied' ? error : null}
          onGrant={handleStart}
          onCancel={handleCloseMicModal}
        />
      )}
    </div>
  );
}
