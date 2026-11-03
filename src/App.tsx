import { useCallback, useEffect, useState } from 'react';
import { AudioLines, BarChart3, PhoneCall, Scale, Signal, Waves } from 'lucide-react';
import { useAudioEngine } from './hooks/useAudioEngine';
import { useSocket } from './hooks/useSocket';
import { useWebRTC } from './hooks/useWebRTC';
import { checkSupport } from './audio/AudioCapture';
import { Home } from './pages/Home';
import { Dashboard } from './pages/Dashboard';
import { Calling } from './pages/Calling';
import { Comparison } from './pages/Comparison';
import { Evaluation } from './pages/Evaluation';
import { StatusPill } from './components/StatusPill';
import { recentCalls } from './services/callHistory';

type Tab = 'home' | 'processing' | 'calling' | 'compare' | 'evaluation';

const TABS: { id: Tab; label: string; icon: typeof Waves }[] = [
  { id: 'home', label: 'Dashboard', icon: Signal },
  { id: 'processing', label: 'Audio processing', icon: Waves },
  { id: 'calling', label: 'Voice calling', icon: PhoneCall },
  { id: 'compare', label: 'A/B comparison', icon: Scale },
  { id: 'evaluation', label: 'Evaluation', icon: BarChart3 },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('home');
  const [support] = useState(() => checkSupport());
  const audio = useAudioEngine();
  const socket = useSocket(true);
  const trackProvider = useCallback(() => audio.engine.getProcessedTrack(), [audio.engine]);
  const call = useWebRTC(trackProvider);
  const [historyVersion, setHistoryVersion] = useState(0);

  useEffect(() => {
    // Refresh the recent-call log whenever a call leaves the active state.
    if (call.phase === 'ended' || call.phase === 'failed') setHistoryVersion((v) => v + 1);
  }, [call.phase]);

  const startCalls = () => {
    if (!audio.snapshot.running) {
      void audio.start().catch(() => undefined);
      return;
    }
    setTab('calling');
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <AudioLines size={19} />
          </span>
          <span>
            ClearVoice
            <span className="brand-sub">Adaptive noise suppression for IP voice</span>
          </span>
        </div>

        <nav className="nav">
          {TABS.map((item) => (
            <button key={item.id} className={`nav-item ${tab === item.id ? 'active' : ''}`} onClick={() => setTab(item.id)}>
              <item.icon size={15} /> {item.label}
            </button>
          ))}
        </nav>

        <div className="topbar-status">
          <StatusPill tone={socket.status === 'online' ? 'online' : socket.status === 'error' ? 'error' : 'busy'}>
            {socket.userId ? `ID ${socket.userId}` : 'Signaling'}
          </StatusPill>
          <StatusPill tone={audio.snapshot.running ? 'online' : 'offline'} pulse={audio.snapshot.running}>
            {audio.snapshot.running ? (audio.snapshot.bypass ? 'DSP bypass' : 'DSP active') : 'DSP stopped'}
          </StatusPill>
          {call.phase === 'active' ? <StatusPill tone="live" pulse>{call.durationLabel}</StatusPill> : null}
        </div>
      </header>

      <main className="content">
        {!support.ok ? (
          <div className="notice error" style={{ marginBottom: 18 }}>
            {support.message}
          </div>
        ) : null}

        {tab === 'home' ? (
          <Home audio={audio} socket={socket} call={call} onStartCalls={startCalls} historyVersion={historyVersion} />
        ) : null}
        {tab === 'processing' ? <Dashboard audio={audio} /> : null}
        {tab === 'calling' ? <Calling audio={audio} socket={socket} call={call} /> : null}
        {tab === 'compare' ? <Comparison audio={audio} /> : null}
        {tab === 'evaluation' ? <Evaluation audio={audio} call={call} /> : null}
      </main>

      <footer className="content" style={{ paddingTop: 0, opacity: 0.75, fontSize: 12.5 }}>
        <div className="row between">
          <span>
            Audio is processed locally in this tab and sent peer-to-peer over WebRTC. The signaling server only relays
            call setup. {recentCalls().length} call record{recentCalls().length === 1 ? '' : 's'} kept locally.
          </span>
          <span className="mono">STFT 512 / hop 256 · sqrt-Hann WOLA · spectral subtraction</span>
        </div>
      </footer>
    </div>
  );
}
