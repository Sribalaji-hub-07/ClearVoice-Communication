import { Gauge, Radio, Sliders, Square, Volume2, Waves } from 'lucide-react';
import type { UseAudioEngine } from '../hooks/useAudioEngine';
import { AudioVisualizer } from '../components/AudioVisualizer';
import { LevelMeter } from '../components/LevelMeter';
import { NoiseControls } from '../components/NoiseControls';
import { StatusPill } from '../components/StatusPill';

interface Props {
  audio: UseAudioEngine;
}

export function Dashboard({ audio }: Props) {
  const { snapshot, engine } = audio;
  const stats = snapshot.stats;
  const running = snapshot.running;

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.55fr) minmax(0, 1fr)' }}>
      <div className="stack">
        <div className="card">
          <div className="card-title row between">
            <span className="row tight">
              <Waves size={14} /> Capture and enhancement
            </span>
            <div className="row tight">
              <button className="btn" style={{ padding: '6px 12px', fontSize: 13 }} disabled={!running} onClick={() => audio.setMonitor(!snapshot.monitoring)}>
                <Volume2 size={14} /> {snapshot.monitoring ? 'Monitor on' : 'Monitor off'}
              </button>
              {running ? (
                <button className="btn danger" style={{ padding: '6px 12px', fontSize: 13 }} onClick={() => void audio.stop()}>
                  <Square size={14} /> Stop
                </button>
              ) : (
                <button className="btn primary" style={{ padding: '6px 12px', fontSize: 13 }} onClick={() => void audio.start()} disabled={audio.starting}>
                  Start processing
                </button>
              )}
            </div>
          </div>

          <div className="stack" style={{ gap: 16 }}>
            <LevelMeter engine={engine} channel="original" label="Original microphone level" running={running} />
            <LevelMeter engine={engine} channel="enhanced" label="Enhanced output level" running={running} />
          </div>

          {snapshot.monitoring ? (
            <div className="notice warn" style={{ marginTop: 14 }}>
              Local monitoring is on. Use headphones - speaker output reaching the microphone will be reprocessed and can
              howl.
            </div>
          ) : null}
          {audio.error ? <div className="notice error" style={{ marginTop: 14 }}>{audio.error}</div> : null}
        </div>

        <div className="card">
          <div className="card-title">
            <Radio size={14} /> Original waveform (microphone, 1024 samples)
          </div>
          <AudioVisualizer engine={engine} kind="waveform-original" running={running} />
          <div className="viz-caption">
            <span>raw input</span>
            <span>time &rarr; 21 ms window</span>
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <Waves size={14} /> Enhanced waveform (after spectral subtraction)
          </div>
          <AudioVisualizer engine={engine} kind="waveform-enhanced" running={running} />
          <div className="viz-caption">
            <span>processed output</span>
            <span>same window, same clock</span>
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <Sliders size={14} /> Frequency spectrum - grey = original, blue = enhanced
          </div>
          <AudioVisualizer engine={engine} kind="spectrum-overlay" running={running} height={190} />
          <div className="viz-caption">
            <span>log-spaced 20 Hz - 24 kHz</span>
            <span>gaps between the two curves are where noise was removed</span>
          </div>
        </div>

        <div className="grid cols-4" style={{ gap: 12 }}>
          <div className="card" style={{ padding: 14 }}>
            <div className="metric-label">Speech activity</div>
            <div style={{ marginTop: 6 }}>
              <StatusPill tone={running ? (stats.speechDetected ? 'online' : 'busy') : 'idle'} pulse={stats.speechDetected}>
                {running ? (stats.speechDetected ? 'Speech' : 'Noise only') : 'Idle'}
              </StatusPill>
            </div>
            <div className="faint" style={{ marginTop: 8 }}>VAD probability {(stats.speechProbability * 100).toFixed(0)}%</div>
          </div>

          <div className="card" style={{ padding: 14 }}>
            <div className="metric-label">Suppression applied</div>
            <div className="metric-value">{running ? stats.suppressionDb.toFixed(1) : '--'}<span className="metric-unit">dB</span></div>
            <div className="faint" style={{ marginTop: 8 }}>floor {running ? stats.noiseFloorDb.toFixed(1) : '--'} &rarr; {running ? stats.residualFloorDb.toFixed(1) : '--'} dBFS</div>
          </div>

          <div className="card" style={{ padding: 14 }}>
            <div className="metric-label">
              <Gauge size={12} /> Algorithm latency
            </div>
            <div className="metric-value">{running ? stats.algorithmLatencyMs.toFixed(1) : '--'}<span className="metric-unit">ms</span></div>
            <div className="faint" style={{ marginTop: 8 }}>frame compute {running ? stats.frameProcessingMs.toFixed(2) : '--'} ms</div>
          </div>

          <div className="card" style={{ padding: 14 }}>
            <div className="metric-label">Total pipeline delay</div>
            <div className="metric-value">{running ? snapshot.pipelineLatencyMs.toFixed(1) : '--'}<span className="metric-unit">ms</span></div>
            <div className="faint" style={{ marginTop: 8 }}>STFT + graph {snapshot.baseLatencyMs.toFixed(1)} + out {snapshot.outputLatencyMs.toFixed(1)} ms</div>
          </div>
        </div>
      </div>

      <div className="stack">
        <NoiseControls params={engine.currentParams} disabled={!running} onChange={audio.setParams} onStrength={audio.applyStrength} />
        <div className="card">
          <div className="card-title">Processor state</div>
          <div className="row between">
            <span className="faint">Sample rate</span>
            <span className="mono">{snapshot.sampleRate} Hz</span>
          </div>
          <div className="row between">
            <span className="faint">Frames processed</span>
            <span className="mono">{stats.framesProcessed.toLocaleString()}</span>
          </div>
          <div className="row between">
            <span className="faint">Audio-thread CPU</span>
            <span className="mono">{(stats.cpuLoad * 100).toFixed(1)}%</span>
          </div>
          <div className="row between">
            <span className="faint">Limited samples</span>
            <span className="mono">{stats.clipped}</span>
          </div>
          <div className="divider" />
          <div className="faint">
            FFT 512 / hop 256 with Hann analysis and synthesis windows, biased-minima noise tracking, decision-directed
            a priori SNR, median-smoothed gains with attack/release envelopes and overlap-add synthesis.
          </div>
        </div>
      </div>
    </div>
  );
}
