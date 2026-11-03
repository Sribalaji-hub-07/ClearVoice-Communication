import type { AudioLevels, EngineSnapshot, NoiseParams, NoiseStats } from '../types/audio';
import { AudioEngineError, DEFAULT_NOISE_PARAMS, EMPTY_STATS } from '../types/audio';
import { NoiseSuppressor, type CaptureListener } from './NoiseSuppressor';
import { openMicrophone, stopStream, DEFAULT_MIC_CONSTRAINTS } from './AudioCapture';
import { levelsFromBuffer } from './audioUtils';

export type EngineStateListener = () => void;

/**
 * Owns the whole capture -> suppression -> output graph.
 *
 * Graph:
 *   microphone -> originalAnalyser (metering tap)
 *   microphone -> worklet (STFT adaptive spectral subtraction)
 *   worklet -> enhancedAnalyser -> streamDestination  (the WebRTC track source)
 *   enhancedAnalyser -> monitorGain -> speakers        (only when monitoring is on)
 */
export class AudioEngine {
  private context: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private originalAnalyser: AnalyserNode | null = null;
  private enhancedAnalyser: AnalyserNode | null = null;
  private monitorGain: GainNode | null = null;
  private streamDest: MediaStreamAudioDestinationNode | null = null;
  private suppressor: NoiseSuppressor | null = null;

  private params: NoiseParams = { ...DEFAULT_NOISE_PARAMS };
  private stats: NoiseStats = { ...EMPTY_STATS };
  private lastError: string | null = null;
  private snapshot: EngineSnapshot = {
    running: false,
    muted: false,
    monitoring: false,
    recording: false,
    bypass: DEFAULT_NOISE_PARAMS.bypass,
    error: null,
    stats: { ...EMPTY_STATS },
    sampleRate: 48000,
    baseLatencyMs: 0,
    outputLatencyMs: 0,
    pipelineLatencyMs: 0,
  };
  private stateListeners = new Set<EngineStateListener>();
  private errorListeners = new Set<(err: AudioEngineError) => void>();
  private captureListeners = new Set<CaptureListener>();

  private originalBuf = new Float32Array(2048);
  private enhancedBuf = new Float32Array(2048);

  private recOriginal: MediaRecorder | null = null;
  private recEnhanced: MediaRecorder | null = null;
  private chunksOriginal: Blob[] = [];
  private chunksEnhanced: Blob[] = [];

  running = false;
  muted = false;
  monitoring = false;
  recording = false;

  get sampleRate(): number {
    return this.context?.sampleRate ?? 48000;
  }

  get currentStats(): NoiseStats {
    return this.stats;
  }

  get currentParams(): NoiseParams {
    return { ...this.params };
  }

  /** Referentially stable between notifications, so useSyncExternalStore can diff it. */
  getSnapshot(): EngineSnapshot {
    return this.snapshot;
  }

  get baseLatencyMs(): number {
    return (this.context?.baseLatency ?? 0) * 1000;
  }

  get outputLatencyMs(): number {
    const ctx = this.context;
    if (!ctx) return 0;
    return (ctx.outputLatency && isFinite(ctx.outputLatency) ? ctx.outputLatency : ctx.baseLatency ?? 0) * 1000;
  }

  /** Time from microphone sample to the track handed to WebRTC, measured from real clocks. */
  get pipelineLatencyMs(): number {
    return this.stats.algorithmLatencyMs + this.baseLatencyMs + this.outputLatencyMs;
  }

  onState(listener: EngineStateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onError(listener: (err: AudioEngineError) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  onCapture(listener: CaptureListener): () => void {
    this.captureListeners.add(listener);
    return () => this.captureListeners.delete(listener);
  }

  private emitError(err: unknown): void {
    const e = err instanceof AudioEngineError ? err : new AudioEngineError('unknown', err instanceof Error ? err.message : 'Audio error');
    this.lastError = `${e.code}: ${e.message}`;
    this.notify();
    for (const listener of this.errorListeners) listener(e);
  }

  private notify(): void {
    this.snapshot = {
      running: this.running,
      muted: this.muted,
      monitoring: this.monitoring,
      recording: this.recording,
      bypass: this.params.bypass,
      error: this.lastError,
      stats: this.stats,
      sampleRate: this.sampleRate,
      baseLatencyMs: this.baseLatencyMs,
      outputLatencyMs: this.outputLatencyMs,
      pipelineLatencyMs: this.pipelineLatencyMs,
    };
    for (const listener of this.stateListeners) listener();
  }

  async start(deviceId?: string): Promise<void> {
    if (this.running) return;

    this.micStream = await openMicrophone({ ...DEFAULT_MIC_CONSTRAINTS, deviceId });
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const context = new Ctor({ sampleRate: 48000, latencyHint: 'interactive' });
    this.context = context;
    if (context.state === 'suspended') await context.resume();

    this.micSource = context.createMediaStreamSource(this.micStream);
    this.micSource.channelCount = 1;
    this.micSource.channelCountMode = 'explicit';

    this.suppressor = await NoiseSuppressor.create(context, this.params);
    this.suppressor.onStats((next) => {
      this.stats = next;
      this.notify();
    });

    this.originalAnalyser = context.createAnalyser();
    this.originalAnalyser.fftSize = 2048;
    this.originalAnalyser.smoothingTimeConstant = 0.6;

    this.enhancedAnalyser = context.createAnalyser();
    this.enhancedAnalyser.fftSize = 2048;
    this.enhancedAnalyser.smoothingTimeConstant = 0.6;

    this.streamDest = context.createMediaStreamDestination();
    this.monitorGain = context.createGain();
    this.monitorGain.gain.value = 0;

    this.micSource.connect(this.originalAnalyser);
    this.micSource.connect(this.suppressor.node);
    this.suppressor.node.connect(this.enhancedAnalyser);
    this.enhancedAnalyser.connect(this.streamDest);
    this.enhancedAnalyser.connect(this.monitorGain);
    this.monitorGain.connect(context.destination);

    this.micStream.getAudioTracks()[0]?.addEventListener('ended', () => {
      if (this.running) {
        this.emitError(new AudioEngineError('device-in-use', 'The microphone was disconnected during the session.'));
        void this.stop();
      }
    });

    this.running = true;
    this.muted = false;
    this.monitoring = false;
    this.lastError = null;
    this.notify();
  }

  async stop(): Promise<void> {
    await this.stopRecording();
    this.suppressor?.dispose();
    try {
      this.micSource?.disconnect();
      this.originalAnalyser?.disconnect();
      this.enhancedAnalyser?.disconnect();
      this.monitorGain?.disconnect();
    } catch {
      /* graph already torn down */
    }
    this.suppressor = null;
    this.micSource = null;
    this.originalAnalyser = null;
    this.enhancedAnalyser = null;
    this.monitorGain = null;
    this.streamDest = null;
    stopStream(this.micStream);
    this.micStream = null;
    if (this.context) {
      const ctx = this.context;
      this.context = null;
      if (ctx.state !== 'closed') await ctx.close().catch(() => undefined);
    }
    this.stats = { ...EMPTY_STATS };
    this.running = false;
    this.muted = false;
    this.monitoring = false;
    this.notify();
  }

  /** The track WebRTC must send: the processed output, never the raw microphone. */
  getProcessedStream(): MediaStream | null {
    return this.streamDest?.stream ?? null;
  }

  getProcessedTrack(): MediaStreamTrack | null {
    return this.streamDest?.stream.getAudioTracks()[0] ?? null;
  }

  /** Raw microphone stream, used for A/B recording and local metering only. */
  getRawStream(): MediaStream | null {
    return this.micStream;
  }

  setParams(partial: Partial<NoiseParams>): void {
    this.params = { ...this.params, ...partial };
    this.suppressor?.setParams(partial);
    this.notify();
  }

  setBypass(bypass: boolean): void {
    this.setParams({ bypass });
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    const track = this.micStream?.getAudioTracks()[0];
    if (track) track.enabled = !muted;
    this.notify();
  }

  setMonitor(on: boolean): void {
    this.monitoring = on;
    if (this.monitorGain && this.context) {
      this.monitorGain.gain.setTargetAtTime(on ? 0.9 : 0, this.context.currentTime, 0.02);
    }
    this.notify();
  }

  readOriginalLevels(): AudioLevels {
    if (!this.originalAnalyser) return { rms: 0, peak: 0, db: -120 };
    this.originalAnalyser.getFloatTimeDomainData(this.originalBuf);
    return levelsFromBuffer(this.originalBuf);
  }

  readEnhancedLevels(): AudioLevels {
    if (!this.enhancedAnalyser) return { rms: 0, peak: 0, db: -120 };
    this.enhancedAnalyser.getFloatTimeDomainData(this.enhancedBuf);
    return levelsFromBuffer(this.enhancedBuf);
  }

  readOriginalWaveform(out: Parameters<AnalyserNode['getFloatTimeDomainData']>[0]): void {
    if (!this.originalAnalyser) return;
    this.originalAnalyser.getFloatTimeDomainData(out);
  }

  readEnhancedWaveform(out: Parameters<AnalyserNode['getFloatTimeDomainData']>[0]): void {
    if (!this.enhancedAnalyser) return;
    this.enhancedAnalyser.getFloatTimeDomainData(out);
  }

  /** Frequency spectrum of the enhanced signal, in dB, 0..255 scaled. */
  readSpectrum(out: Parameters<AnalyserNode['getByteFrequencyData']>[0]): void {
    if (!this.enhancedAnalyser) return;
    this.enhancedAnalyser.getByteFrequencyData(out);
  }

  /** Spectrum of the raw microphone, for the original-vs-enhanced overlay. */
  readOriginalSpectrum(out: Parameters<AnalyserNode['getByteFrequencyData']>[0]): void {
    if (!this.originalAnalyser) return;
    this.originalAnalyser.getByteFrequencyData(out);
  }

  captureForEvaluation(seconds = 2): void {
    this.suppressor?.capture(seconds);
  }

  startRecording(): void {
    if (!this.micStream || !this.streamDest) {
      this.emitError(new AudioEngineError('unknown', 'Start processing before recording.'));
      return;
    }
    const mimeRaw = pickMime(['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']);
    if (!mimeRaw) {
      this.emitError(new AudioEngineError('unknown', 'This browser has no MediaRecorder audio codec available.'));
      return;
    }
    this.chunksOriginal = [];
    this.chunksEnhanced = [];
    this.recOriginal = new MediaRecorder(this.micStream, { mimeType: mimeRaw });
    this.recEnhanced = new MediaRecorder(this.streamDest.stream, { mimeType: mimeRaw });
    this.recOriginal.ondataavailable = (e) => e.data.size && this.chunksOriginal.push(e.data);
    this.recEnhanced.ondataavailable = (e) => e.data.size && this.chunksEnhanced.push(e.data);
    this.recOriginal.start(250);
    this.recEnhanced.start(250);
    this.recording = true;
    this.notify();
  }

  /** Returns parallel original/enhanced recordings so the two can be A/B compared. */
  async stopRecording(): Promise<{ original: Blob | null; enhanced: Blob | null }> {
    const originalRec = this.recOriginal;
    const enhancedRec = this.recEnhanced;
    this.recOriginal = null;
    this.recEnhanced = null;
    this.recording = false;
    this.notify();

    const finish = (rec: MediaRecorder | null, chunks: Blob[]) =>
      new Promise<Blob | null>((resolve) => {
        if (!rec) return resolve(null);
        const build = () => resolve(chunks.length ? new Blob(chunks, { type: rec.mimeType }) : null);
        if (rec.state === 'inactive') return build();
        rec.onstop = build;
        try {
          rec.stop();
        } catch {
          build();
        }
      });

    const [original, enhanced] = await Promise.all([
      finish(originalRec, this.chunksOriginal),
      finish(enhancedRec, this.chunksEnhanced),
    ]);
    this.chunksOriginal = [];
    this.chunksEnhanced = [];
    return { original, enhanced };
  }
}

function pickMime(candidates: string[]): string | null {
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c;
  }
  return null;
}
