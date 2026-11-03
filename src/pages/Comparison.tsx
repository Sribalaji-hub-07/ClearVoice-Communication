import { useEffect, useRef, useState } from 'react';
import { AArrowDown, CircleStop, Download, PlayCircle, Radio, Square } from 'lucide-react';
import type { UseAudioEngine } from '../hooks/useAudioEngine';
import { LevelMeter } from '../components/LevelMeter';
import { AudioVisualizer } from '../components/AudioVisualizer';

interface Props {
  audio: UseAudioEngine;
}

/**
 * Before/after monitoring. Both recordings are captured live from the same
 * microphone session: the raw stream and the suppressor output.
 */
export function Comparison({ audio }: Props) {
  const { snapshot, engine } = audio;
  const [ab, setAb] = useState<'original' | 'enhanced'>('enhanced');
  const [elapsed, setElapsed] = useState(0);
  const originalRef = useRef<HTMLAudioElement | null>(null);
  const enhancedRef = useRef<HTMLAudioElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!snapshot.recording) return;
    const timer = window.setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => window.clearInterval(timer);
  }, [snapshot.recording]);

  const record = async () => {
    setError(null);
    if (!snapshot.running) {
      setError('Start processing first - recording needs a live microphone session.');
      return;
    }
    try {
      setElapsed(0);
      await audio.startRecording();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Recording failed.');
    }
  };

  const stop = async () => {
    await audio.stopRecording();
  };

  const pauseBoth = () => {
    originalRef.current?.pause();
    enhancedRef.current?.pause();
  };

  const play = (which: 'original' | 'enhanced') => {
    pauseBoth();
    const el = which === 'original' ? originalRef.current : enhancedRef.current;
    if (!el) return;
    el.currentTime = 0;
    void el.play();
  };

  const recordingUrl = ab === 'original' ? audio.recordings?.originalUrl : audio.recordings?.enhancedUrl;

  return (
    <div className="grid cols-2">
      <div className="stack">
        <div className="card">
          <div className="card-title">
            <Radio size={14} /> Live monitoring
          </div>
          <div className="stack" style={{ gap: 14 }}>
            <LevelMeter engine={engine} channel="original" label="Original microphone" running={snapshot.running} />
            <LevelMeter engine={engine} channel="enhanced" label="Enhanced output" running={snapshot.running} />
          </div>
          <div className="divider" />
          <AudioVisualizer engine={engine} kind="spectrum-overlay" running={snapshot.running} height={170} />
          <div className="viz-caption">
            <span>grey = microphone</span>
            <span>blue = after suppression</span>
          </div>
          {error ? <div className="notice error" style={{ marginTop: 12 }}>{error}</div> : null}
        </div>

        <div className="card">
          <div className="card-title">Record a paired sample</div>
          <div className="faint" style={{ marginBottom: 12 }}>
            Captures the raw microphone and the processed output simultaneously so you can A/B the exact same speech and
            noise. Files stay in this browser tab.
          </div>
          <div className="row tight">
            {snapshot.recording ? (
              <button className="btn danger lg" onClick={() => void stop()}>
                <CircleStop size={17} /> Stop recording ({elapsed}s)
              </button>
            ) : (
              <button className="btn primary lg" onClick={() => void record()} disabled={!snapshot.running}>
                <Square size={17} /> Record both channels
              </button>
            )}
            <button className="btn" onClick={() => engine.setMonitor(!snapshot.monitoring)} disabled={!snapshot.running}>
              <PlayCircle size={16} /> {snapshot.monitoring ? 'Monitor on' : 'Monitor off'}
            </button>
          </div>
        </div>
      </div>

      <div className="stack">
        <div className="card">
          <div className="card-title">
            <AArrowDown size={14} /> Before / after playback
          </div>
          {!audio.recordings ? (
            <div className="faint">No recording yet. Record a sample on the left, then compare the two channels here.</div>
          ) : (
            <div className="stack" style={{ gap: 12 }}>
              <div className="row tight">
                <button className={`btn ${ab === 'original' ? '' : 'ghost'}`} onClick={() => setAb('original')}>
                  Original (noisy)
                </button>
                <button className={`btn ${ab === 'enhanced' ? 'primary' : 'ghost'}`} onClick={() => setAb('enhanced')}>
                  Enhanced (suppressed)
                </button>
              </div>

              {audio.recordings.originalUrl ? (
                <div>
                  <div className="metric-label" style={{ marginBottom: 6 }}>Original capture</div>
                  <audio ref={originalRef} src={audio.recordings.originalUrl} controls onPlay={pauseBoth} />
                </div>
              ) : (
                <div className="notice warn">The original channel was not recorded by this browser.</div>
              )}

              {audio.recordings.enhancedUrl ? (
                <div>
                  <div className="metric-label" style={{ marginBottom: 6 }}>Enhanced capture</div>
                  <audio ref={enhancedRef} src={audio.recordings.enhancedUrl} controls onPlay={pauseBoth} />
                </div>
              ) : (
                <div className="notice warn">The enhanced channel was not recorded by this browser.</div>
              )}

              <div className="row tight">
                <button className="btn" onClick={() => play(ab)}>
                  <PlayCircle size={15} /> Play {ab}
                </button>
                {recordingUrl ? (
                  <a className="btn ghost" href={recordingUrl} download={`clearvoice-${ab}-${audio.recordings.takenAt}.webm`}>
                    <Download size={15} /> Download {ab}
                  </a>
                ) : null}
              </div>
              <div className="faint">
                Both files use the same codec and duration, so a null test in an editor is meaningful.
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-title">What to listen for</div>
          <ul className="faint" style={{ paddingLeft: 18, margin: 0, lineHeight: 1.9 }}>
            <li>Wind rumble and engine drone should drop in level without the voice thinning out.</li>
            <li>Horns and sirens are tonal: expect them to survive partly - they sit in the speech band.</li>
            <li>Watch for &quot;musical noise&quot; - isolated chirps in the silence. If present, raise the spectral floor or
              lengthen the release.</li>
            <li>If consonants lose crispness, lower the strength or raise speech preservation.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
