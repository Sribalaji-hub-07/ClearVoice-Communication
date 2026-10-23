import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioEngine } from './audio/audioEngine';
import { AudioRecorder, type RecordingResult } from './audio/recorder';
import type { LevelReport, MicPermissionState, MonitorMode, ProcessingState } from './audio/types';

import StatusPanel from './components/StatusPanel';
import Controls from './components/Controls';
import LevelMeters from './components/LevelMeters';
import VisualizerGrid from './components/VisualizerGrid';
import ComparisonPanel from './components/ComparisonPanel';
import RecordingPanel from './components/RecordingPanel';
import InCallView from './components/InCallView';
import BottomNavBar, { type TabType } from './components/BottomNavBar';
import ChatsTab from './components/ChatsTab';
import CallsTab from './components/CallsTab';
import ProfileTab from './components/ProfileTab';
import AuthLanding from './components/AuthLanding';
import SignUpPage from './components/SignUpPage';
import LoginPage from './components/LoginPage';
import ContactProfileModal from './components/ContactProfileModal';
import SplashScreen from './components/SplashScreen';
import IncomingCall from './components/IncomingCall';
import MicPermissionModal from './components/MicPermissionModal';

import { getCurrentUser, logoutUser, type UserProfile, type ContactInfo } from './utils/userAuth';
import { getSettings, type AppSettings } from './utils/settingsStorage';
import { setDemoToastCallback } from './utils/otpService';
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

  const [settings, setSettings] = useState<AppSettings>(getSettings());
  const [suppression, setSuppression] = useState(settings.defaultSuppression);

  // Socket.IO Connection
  useEffect(() => {
    if (currentUser) {
      socketService.connectSocket(currentUser.id, currentUser.name);
    }
    return () => {
      socketService.disconnectSocket();
    };
  }, [currentUser]);

  const call = useCall(currentUser?.id || '', currentUser?.name || '');

  // Demo toast for OTP display
  const [demoToast, setDemoToast] = useState<string | null>(null);
  const showDemoToast = useCallback((msg: string) => {
    setDemoToast(msg);
    setTimeout(() => setDemoToast(null), 8000);
  }, []);

  // Register demo toast callback for OTP service
  useEffect(() => {
    setDemoToastCallback(showDemoToast);
  }, [showDemoToast]);

  // ============================================================
  // P2P CHAT — use STATE (not ref) so re-renders propagate to ChatsTab
  // ============================================================
  const [chatPeer, setChatPeer] = useState<ChatPeerManager | null>(null);
  const [onlinePeers, setOnlinePeers] = useState<Set<string>>(new Set());
  const [isP2PConnected, setIsP2PConnected] = useState(false);
  // Increment this whenever a P2P message arrives so ChatsTab refreshes
  const [p2pMsgTrigger, setP2pMsgTrigger] = useState(0);

  // Use a ref for the incoming-message handler so the ChatPeerManager's
  // callback always calls the latest closure without needing to tear down
  // and reconnect the peer when currentUser changes.
  const incomingMsgHandlerRef = useRef<(msg: P2PMessage) => void>(() => {});
  const activeChatContactRef = useRef<ContactInfo | null>(null);

  // Keep refs in sync
  useEffect(() => {
    activeChatContactRef.current = activeChatContact;
  }, [activeChatContact]);

  useEffect(() => {
    incomingMsgHandlerRef.current = (msg: P2PMessage) => {
      if (msg.type === 'chat' && msg.text) {
        // Save to localStorage
        saveMessage(msg.senderId, {
          senderId: msg.senderId,
          receiverId: currentUser?.id || '',
          text: msg.text,
          timestamp: msg.timestamp,
          status: 'delivered',
        });

        // Ensure a chat thread exists for this contact
        const threads = getChatThreads();
        const existing = threads.find((t) => t.contactId === msg.senderId);
        if (!existing) {
          saveChatThread({
            contactId: msg.senderId,
            contactName: msg.senderName || `User #${msg.senderId}`,
            contactEmail: `${msg.senderId}@clearvoice.app`,
            contactStatus: 'ClearVoice Peer',
            avatarColor: '#00F576',
            lastMessage: msg.text,
            lastTimestamp: msg.timestamp,
            unreadCount: 1,
          });
        } else {
          saveChatThread({
            ...existing,
            lastMessage: msg.text,
            lastTimestamp: msg.timestamp,
            unreadCount:
              activeChatContactRef.current?.id === msg.senderId
                ? 0
                : existing.unreadCount + 1,
          });
        }

        // Trigger ChatsTab refresh
        setP2pMsgTrigger((prev) => prev + 1);
      }
    };
  }, [currentUser?.id]);

  // Create and connect the ChatPeerManager when user is logged in
  useEffect(() => {
    if (!currentUser) {
      setChatPeer(null);
      setIsP2PConnected(false);
      return;
    }

    const peer = new ChatPeerManager(currentUser.id, currentUser.name, {
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

    setChatPeer(peer); // Set as STATE so ChatsTab gets it on re-render
    peer.connect().catch((err) => {
      console.error('Failed to connect ChatPeerManager:', err);
    });

    return () => {
      peer.disconnect();
      setChatPeer(null);
      setIsP2PConnected(false);
    };
    // Only re-create when user ID changes, not on every currentUser object change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  // Audio engine refs
  const engineRef = useRef<AudioEngine | null>(null);
  const recorderRef = useRef<AudioRecorder>(new AudioRecorder());

  const [micPermission, setMicPermission] = useState<MicPermissionState>('idle');
  const [processingState, setProcessingState] = useState<ProcessingState>('stopped');
  const [error, setError] = useState<string | null>(null);
  const [levels, setLevels] = useState<LevelReport | null>(null);
  const [monitorMode, setMonitorMode] = useState<MonitorMode>('none');
  const [sampleRate, setSampleRate] = useState<number | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordings, setRecordings] = useState<RecordingResult[]>([]);
  const [analysers, setAnalysers] = useState<{
    original: AnalyserNode | null;
    enhanced: AnalyserNode | null;
  }>({ original: null, enhanced: null });

  const isRunning = processingState === 'running';
  const isStarting = processingState === 'starting';
  const isCallActive = call.callState !== 'idle';

  const latencyMs = sampleRate ? (1024 / sampleRate) * 1000 : null;

  // --- Audio Engine ---

  useEffect(() => {
    return () => {
      engineRef.current?.stop();
    };
  }, []);

  const handleStart = useCallback(async (): Promise<boolean> => {
    setError(null);
    setMicPermission('requesting');

    const engine = new AudioEngine({
      onLevels: (l) => setLevels(l),
      onError: (message) => {
        setError(message);
        setMicPermission((prev) => (prev === 'requesting' ? 'denied' : prev));
      },
      onStateChange: (state) => setProcessingState(state),
    });
    engineRef.current = engine;

    const ok = await engine.start();
    if (ok) {
      setMicPermission('granted');
      setSampleRate(engine.context?.sampleRate ?? null);
      setAnalysers(engine.analysers);
      engine.setSuppressionAmount(suppression);
      engine.setMonitorMode(monitorMode);
    } else {
      setSampleRate(null);
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
    setAnalysers({ original: null, enhanced: null });
    setSampleRate(null);
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

  const handleMonitorChange = useCallback((mode: MonitorMode) => {
    setMonitorMode(mode);
    engineRef.current?.setMonitorMode(mode);
  }, []);

  const handleResetNoiseProfile = useCallback(() => {
    engineRef.current?.resetNoiseProfile();
  }, []);

  const handleStartRecording = useCallback(() => {
    const stream = engineRef.current?.recordingStream;
    if (!stream) return;
    const started = recorderRef.current.start(stream);
    if (started) setIsRecording(true);
    else setError('Recording is not supported in this browser.');
  }, []);

  const handleStopRecording = useCallback(async () => {
    const result = await recorderRef.current.stop();
    setIsRecording(false);
    if (result) setRecordings((prev) => [result, ...prev]);
  }, []);

  // --- Call Management ---

  const handleStartCall = async (receiverId: string, receiverName: string) => {
    setActiveTab('calls');
    const ready = await ensureProcessingRunning();
    if (!ready || !engineRef.current?.callStream) return;
    call.startCall(receiverId, receiverName, engineRef.current.callStream);
  };

  const handleAcceptCall = async () => {
    setActiveTab('calls');
    const ready = await ensureProcessingRunning();
    if (!ready || !engineRef.current?.callStream) return;
    call.acceptCall(engineRef.current.callStream);
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
  };

  return (
    <div className="app-container">
      {/* Demo OTP Toast */}
      {demoToast && <div className="demo-otp-toast">{demoToast}</div>}

      {/* Splash Screen */}
      <SplashScreen />

      {/* Auth Screens (if user is not signed in) */}
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
          demoToast={showDemoToast}
        />
      )}
      {!currentUser && authView === 'login' && (
        <LoginPage
          onSuccess={handleAuthSuccess}
          onGoToSignUp={() => setAuthView('signup')}
          demoToast={showDemoToast}
        />
      )}

      {/* Top ClearVoice Neo-Brutalist Header Bar */}
      {currentUser && (
        <header className="app-header-bar">
          <div className="header-brand-wrap">
            <div className="header-brand-mark">CV</div>
            <div className="header-brand-info">
              <h1 className="header-brand-title">CLEARVOICE</h1>
              <span className="header-brand-status">
                <span className={`status-dot-sm ${isRunning ? 'live' : ''}`} />
                {currentUser.name} (#{currentUser.id}) ·{' '}
                {isP2PConnected ? (
                  <span style={{ color: '#00F576' }}>P2P CONNECTED</span>
                ) : (
                  'CONNECTING…'
                )}
              </span>
            </div>
          </div>

          <div className="header-actions">
            {isRunning ? (
              <button
                className="header-pill-btn active"
                onClick={handleStop}
                title="Stop DSP Audio Processing"
              >
                STOP DSP ✕
              </button>
            ) : (
              <button
                className="header-pill-btn"
                onClick={handleStart}
                disabled={isStarting}
                title="Start DSP Audio Processing"
              >
                {isStarting ? 'STARTING…' : 'START DSP ⚡'}
              </button>
            )}
          </div>
        </header>
      )}

      {/* Main Tab Views */}
      {currentUser && (
        <main className="app-content-body">
          {activeTab === 'chats' && (
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
          )}

          {activeTab === 'calls' && (
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
          )}

          {activeTab === 'profile' && (
            <ProfileTab
              currentUser={currentUser}
              settings={settings}
              suppression={suppression}
              onUpdateUser={setCurrentUser}
              onSuppressionChange={handleSuppressionChange}
              onSettingsChange={setSettings}
              onLogout={handleLogout}
            />
          )}

          {activeTab === 'lab' && (
            <div className="tab-pane lab-tab">
              <div className="lab-header-banner">
                <span className="pill">CLEARVOICE DSP LABORATORY</span>
                <h2>REAL-TIME SPECTRAL SUBTRACTION</h2>
                <p>
                  Inspect real-time FFT spectrograms, waveforms, noise estimators, and audio
                  comparison monitors running inside the dedicated AudioWorklet.
                </p>
              </div>

              <div className="dashboard-grid">
                <div>
                  <StatusPanel
                    micPermission={micPermission}
                    processingState={processingState}
                    error={error}
                    sampleRate={sampleRate}
                    latencyMs={latencyMs}
                  />
                  <Controls
                    isRunning={isRunning}
                    isStarting={isStarting}
                    suppression={suppression}
                    onStart={handleStart}
                    onStop={handleStop}
                    onSuppressionChange={handleSuppressionChange}
                    onResetNoiseProfile={handleResetNoiseProfile}
                  />
                  <LevelMeters levels={levels} suppression={suppression} />
                </div>

                <div>
                  <VisualizerGrid
                    originalAnalyser={analysers.original}
                    enhancedAnalyser={analysers.enhanced}
                    active={isRunning}
                  />
                  <ComparisonPanel
                    mode={monitorMode}
                    onChange={handleMonitorChange}
                    disabled={!isRunning}
                  />
                  <RecordingPanel
                    isRecording={isRecording}
                    canRecord={isRunning}
                    onStart={handleStartRecording}
                    onStop={handleStopRecording}
                    recordings={recordings}
                  />
                </div>
              </div>
            </div>
          )}
        </main>
      )}

      {/* Bottom Navigation Bar */}
      {currentUser && (
        <BottomNavBar
          activeTab={activeTab}
          onChangeTab={(t) => {
            if (activeTab === 'chats' && activeChatContact && t !== 'chats') {
              setActiveChatContact(null);
            }
            setActiveTab(t);
          }}
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
          onStartCall={(id: string, name?: string) => handleStartCall(id, name ?? `User #${id}`)}
        />
      )}

      {/* Incoming Call Overlay */}
      {call.callState === 'ringing' && call.callInfo?.receiverId === currentUser?.id && (
        <IncomingCall
          callInfo={call.callInfo!}
          onAccept={handleAcceptCall}
          onReject={call.rejectCall}
        />
      )}

      {/* Full-Screen In-Call View */}
      {call.callState !== 'idle' && call.callState !== 'ringing' && (
        <InCallView
          role={call.callInfo?.callerId === currentUser?.id ? 'caller' : 'receiver'}
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

      {/* Mic Permission Glassmorphism Modal */}
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
