import { useEffect, useRef, useState } from 'react';
import { BarChart3, Download, Gauge, RefreshCw, Timer } from 'lucide-react';
import type { UseAudioEngine } from '../hooks/useAudioEngine';
import { useEvaluationCapture } from '../hooks/useAudioEngine';
import type { UseWebRtc } from '../hooks/useWebRTC';
import { compareCapture, toResultRow, type ResultRow } from '../audio/evaluation';
import { downloadBlob, encodeWav, formatNum } from '../audio/audioUtils';
import { ResultsTable } from '../components/ResultsTable';
import { StatusPill } from '../components/StatusPill';

interface Props {
  audio: UseAudioEngine;
  call: UseWebRtc;
}

const CONDITIONS = [
  'Clean speech (quiet room)',
  'Speech with wind noise',
  'Speech with traffic noise',
  'Speech with motorcycle engine',
  'Speech with horn sounds',
  'Speech with multiple noises',
];

/** A reference-free measure can come back unmeasurable; the observation must say so, not guess. */
function describeFloorChange(db: number): string {
  if (!Number.isFinite(db)) return 'floor not measurable';
  return `floor ${db >= 0 ? 'down' : 'up'} ${Math.abs(db).toFixed(1)} dB`;
}

export function Evaluation({ audio, call }: Props) {
  const { snapshot } = audio;
  const { result, request } = useEvaluationCapture(2);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [condition, setCondition] = useState(CONDITIONS[1]);
  const [detail, setDetail] = useState<string | null>(null);
  const pending = useRef<string>(CONDITIONS[1]);

  // Every number below is computed from the buffers the worklet handed back.
  useEffect(() => {
    if (!result || result.seconds <= 0) return;
    const comparison = compareCapture(result, snapshot.stats.algorithmLatencyMs);
    const change = comparison.activeSpeechEnergyChangeDb;
    const speechNote = !Number.isFinite(change)
      ? 'speech level not measurable'
      : Math.abs(change) < 2
        ? 'speech preserved'
        : `speech shifted ${change > 0 ? '+' : ''}${change.toFixed(1)} dB`;
    setRows((previous) => [
      ...previous,
      toResultRow(
        pending.current,
        comparison,
        `${describeFloorChange(comparison.noiseFloorReductionDb)}` +
          ` · flatness ${comparison.original.flatness.toFixed(3)} to ${comparison.enhanced.flatness.toFixed(3)}` +
          ` · ${speechNote}`,
      ),
    ]);
    setDetail(
      `Analysed ${comparison.original.durationSec.toFixed(2)} s of aligned audio. ` +
        `Original: RMS ${formatNum(comparison.original.rmsDb)} dBFS, floor ${formatNum(comparison.original.noiseFloorDb)} dBFS, ` +
        `speech ${formatNum(comparison.original.speechLevelDb)} dBFS, SNR ${formatNum(comparison.original.snrDb)} dB, ` +
        `${Math.round(comparison.original.activeFrameRatio * 100)}% active frames. ` +
        `Enhanced: RMS ${formatNum(comparison.enhanced.rmsDb)} dBFS, floor ${formatNum(comparison.enhanced.noiseFloorDb)} dBFS, ` +
        `speech ${formatNum(comparison.enhanced.speechLevelDb)} dBFS, SNR ${formatNum(comparison.enhanced.snrDb)} dB, ` +
        `${Math.round(comparison.enhanced.activeFrameRatio * 100)}% active frames.`,
    );
  }, [result, snapshot.stats.algorithmLatencyMs]);

  const measure = () => {
    pending.current = condition;
    request();
  };

  const exportWav = (which: 'original' | 'enhanced') => {
    if (!result) return;
    const samples = which === 'original' ? result.original : result.enhanced;
    downloadBlob(encodeWav(samples, result.sampleRate), `clearvoice-${which}-${Date.now()}.wav`);
  };

  const stats = snapshot.stats;

  return (
    <div className="stack">
      <div className="grid cols-2">
        <div className="card">
          <div className="card-title">
            <BarChart3 size={14} /> Measurement session
          </div>
          <div className="field">
            <label className="label" htmlFor="cv-condition">
              Noise condition
            </label>
            <select id="cv-condition" className="input" value={condition} onChange={(e) => setCondition(e.target.value)}>
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="row tight" style={{ marginTop: 14 }}>
            <button className="btn primary lg" onClick={measure} disabled={!snapshot.running}>
              <RefreshCw size={16} /> Measure 2 s
            </button>
            <StatusPill tone={snapshot.running ? 'live' : 'offline'}>
              {snapshot.running ? 'Processor running' : 'Start processing first'}
            </StatusPill>
          </div>
          <div className="faint" style={{ marginTop: 12 }}>
            Press measure while the selected condition plays and you speak. The processor returns the microphone and the
            suppressed signal as one time-aligned pair, so the two analyses describe the exact same speech.
          </div>
          {detail ? <div className="notice info" style={{ marginTop: 14 }}>{detail}</div> : null}
          {result ? (
            <div className="row tight" style={{ marginTop: 14 }}>
              <button className="btn ghost" onClick={() => exportWav('original')} style={{ fontSize: 13 }}>
                <Download size={14} /> Export original WAV
              </button>
              <button className="btn ghost" onClick={() => exportWav('enhanced')} style={{ fontSize: 13 }}>
                <Download size={14} /> Export enhanced WAV
              </button>
            </div>
          ) : null}
        </div>

        <div className="card">
          <div className="card-title">
            <Timer size={14} /> Latency accounting
          </div>
          <div className="grid cols-2" style={{ gap: 12 }}>
            <div>
              <div className="metric-value">{snapshot.running ? stats.algorithmLatencyMs.toFixed(2) : '--'}<span className="metric-unit">ms</span></div>
              <div className="metric-label">Algorithm delay (N/fs)</div>
            </div>
            <div>
              <div className="metric-value">{snapshot.running ? stats.frameProcessingMs.toFixed(2) : '--'}<span className="metric-unit">ms</span></div>
              <div className="metric-label">Frame compute time</div>
            </div>
            <div>
              <div className="metric-value">{snapshot.running ? snapshot.pipelineLatencyMs.toFixed(2) : '--'}<span className="metric-unit">ms</span></div>
              <div className="metric-label">Capture to track (local)</div>
            </div>
            <div>
              <div className="metric-value">{call.metrics.available ? call.metrics.roundTripMs.toFixed(0) : '--'}<span className="metric-unit">ms</span></div>
              <div className="metric-label">Network RTT (during a call)</div>
            </div>
          </div>
          <div className="divider" />
          <div className="row between">
            <span className="faint row tight">
              <Gauge size={13} /> Audio-thread CPU
            </span>
            <span className="mono">{(stats.cpuLoad * 100).toFixed(1)}%</span>
          </div>
          <div className="row between">
            <span className="faint">Sample rate / hop</span>
            <span className="mono">{snapshot.sampleRate} Hz / 256</span>
          </div>
          {call.metrics.available ? (
            <>
              <div className="row between">
                <span className="faint">Packet loss</span>
                <span className="mono">{call.metrics.packetLossPercent.toFixed(2)}%</span>
              </div>
              <div className="row between">
                <span className="faint">Jitter / jitter buffer</span>
                <span className="mono">
                  {call.metrics.jitterMs.toFixed(1)} / {call.metrics.jitterBufferMs.toFixed(0)} ms
                </span>
              </div>
            </>
          ) : (
            <div className="faint" style={{ marginTop: 8 }}>
              Network figures appear while a WebRTC call is connected. Algorithm latency and network latency are always
              reported separately.
            </div>
          )}
        </div>
      </div>

      <ResultsTable rows={rows} />

      <div className="card">
        <div className="card-title">Subjective listening checks</div>
        <div className="faint" style={{ lineHeight: 1.9 }}>
          PESQ and STOI need the clean reference signal and a licensed implementation - neither is available inside the
          browser, so they are not reported here. Export the paired WAV files above and run them through
          <span className="mono"> pesq </span>(Python) or the STOI reference implementation for those scores. The
          reference-free measures in the table (SNR estimate, noise-floor reduction, spectral flatness, active-frame
          ratio) are what this build can compute from live audio.
        </div>
      </div>
    </div>
  );
}
