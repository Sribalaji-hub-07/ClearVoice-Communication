/**
 * Shared types for the ClearVoice adaptive noise suppression audio engine.
 */

/** Tunable parameters of the STFT adaptive spectral subtraction processor. */
export interface NoiseParams {
  /** Over-subtraction factor (alpha) applied to the estimated noise magnitude. 1.0 - 4.0 */
  overSubtraction: number;
  /** Relative spectral floor as a fraction of the noisy magnitude. 0.005 - 0.25 */
  spectralFloor: number;
  /** Smoothing coefficient of the noise spectrum tracker (log domain). 0.80 - 0.995 */
  noiseSmoothing: number;
  /** Amount of the noisy frame that is blended back in bins with high a-priori SNR. 0 - 0.9 */
  speechPreservation: number;
  /** Gain attack time constant in milliseconds (how fast suppression engages). 2 - 40 */
  attackMs: number;
  /** Gain release time constant in milliseconds (how fast gain recovers). 20 - 300 */
  releaseMs: number;
  /** VAD sensitivity: higher = more frames are treated as speech. 0.1 - 0.9 */
  vadThreshold: number;
  /** Broadband reduction strength 0-100; drives alpha and floor in the UI. */
  reductionStrength: number;
  /** Bypass the processor entirely (raw microphone passes through). */
  bypass: boolean;
}

/** Per-bin FFT size used by the worklet. Must stay in sync with the worklet source. */
export const FFT_SIZE = 512;
/** Frame hop in samples (50% overlap). Must stay in sync with the worklet source. */
export const HOP_SIZE = 256;

export const DEFAULT_NOISE_PARAMS: NoiseParams = {
  overSubtraction: 2.0,
  spectralFloor: 0.02,
  noiseSmoothing: 0.92,
  speechPreservation: 0.25,
  attackMs: 8,
  releaseMs: 120,
  vadThreshold: 0.4,
  reductionStrength: 60,
  bypass: false,
};

/** Live statistics pushed from the AudioWorklet to the UI thread. */
export interface NoiseStats {
  /** True when the current frame is classified as speech. */
  speechDetected: boolean;
  /** Speech probability of the current frame, 0..1. */
  speechProbability: number;
  /** Measured input noise floor during non-speech frames, dBFS. */
  noiseFloorDb: number;
  /** Measured output noise floor during non-speech frames, dBFS. */
  residualFloorDb: number;
  /** Measured noise-floor reduction (noiseFloorDb - residualFloorDb), dB. */
  suppressionDb: number;
  /** Mean speech-band gain applied by the filter, dB. */
  avgGainDb: number;
  /** Sample rate the processor runs at. */
  sampleRate: number;
  /** STFT algorithmic delay (N / fs) in milliseconds. */
  algorithmLatencyMs: number;
  /** Measured time spent inside processFrame(), averaged over the reporting window. */
  frameProcessingMs: number;
  /** frameProcessingMs divided by the real-time budget per hop. */
  cpuLoad: number;
  /** Frames processed since the engine started. */
  framesProcessed: number;
  /** Samples that hit the output limiter. */
  clipped: number;
  /** Whether the processor is currently bypassed. */
  bypass: boolean;
  /** performance.now() on the audio thread when the message was sent. */
  timestamp: number;
}

export const EMPTY_STATS: NoiseStats = {
  speechDetected: false,
  speechProbability: 0,
  noiseFloorDb: -120,
  residualFloorDb: -120,
  suppressionDb: 0,
  avgGainDb: 0,
  sampleRate: 48000,
  algorithmLatencyMs: 0,
  frameProcessingMs: 0,
  cpuLoad: 0,
  framesProcessed: 0,
  clipped: 0,
  bypass: false,
  timestamp: 0,
};

/** Levels measured from an AnalyserNode time-domain buffer. */
export interface AudioLevels {
  rms: number;
  peak: number;
  db: number;
}

/** Snapshot of everything the dashboard renders. */
export interface EngineSnapshot {
  running: boolean;
  muted: boolean;
  monitoring: boolean;
  recording: boolean;
  bypass: boolean;
  error: string | null;
  stats: NoiseStats;
  sampleRate: number;
  /** AudioContext scheduling latency in milliseconds. */
  baseLatencyMs: number;
  outputLatencyMs: number;
  /** STFT delay plus graph latency: what the far end actually experiences. */
  pipelineLatencyMs: number;
}

/** Error codes surfaced by the engine so the UI can show actionable messages. */
export type AudioEngineErrorCode =
  | 'permission-denied'
  | 'no-microphone'
  | 'device-in-use'
  | 'worklet-unsupported'
  | 'worklet-load-failed'
  | 'audio-context-failed'
  | 'insecure-context'
  | 'unknown';

export class AudioEngineError extends Error {
  code: AudioEngineErrorCode;
  constructor(code: AudioEngineErrorCode, message: string) {
    super(message);
    this.name = 'AudioEngineError';
    this.code = code;
  }
}
