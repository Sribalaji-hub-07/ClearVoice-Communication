import type { NoiseParams, NoiseStats } from '../types/audio';
import { EMPTY_STATS } from '../types/audio';
import { AudioEngineError } from '../types/audio';
import workletUrl from '../worklets/noise-suppressor-worklet.js?url';

export interface CaptureResult {
  original: Float32Array;
  enhanced: Float32Array;
  sampleRate: number;
  seconds: number;
}

export type StatsListener = (stats: NoiseStats) => void;
export type CaptureListener = (result: CaptureResult) => void;

/**
 * Main-thread handle on the STFT spectral-subtraction AudioWorklet.
 * Owns the node, its parameter channel and its statistics/capture message channel.
 */
export class NoiseSuppressor {
  readonly node: AudioWorkletNode;
  private stats: NoiseStats = { ...EMPTY_STATS };
  private statsListeners = new Set<StatsListener>();
  private captureListeners = new Set<CaptureListener>();
  private params: NoiseParams;

  private constructor(node: AudioWorkletNode, params: NoiseParams) {
    this.node = node;
    this.params = params;
    this.node.port.onmessage = (event: MessageEvent) => {
      const msg = event.data;
      if (!msg) return;
      if (msg.type === 'stats') {
        this.stats = { ...this.stats, ...msg };
        for (const listener of this.statsListeners) listener(this.stats);
      } else if (msg.type === 'capture-result') {
        for (const listener of this.captureListeners) {
          listener({ original: msg.original, enhanced: msg.enhanced, sampleRate: msg.sampleRate, seconds: msg.seconds });
        }
      }
    };
  }

  static async create(context: BaseAudioContext, params: NoiseParams): Promise<NoiseSuppressor> {
    if (!context.audioWorklet) {
      throw new AudioEngineError('worklet-unsupported', 'This browser cannot run AudioWorklet modules.');
    }
    try {
      await context.audioWorklet.addModule(workletUrl);
    } catch (err) {
      throw new AudioEngineError(
        'worklet-load-failed',
        `Failed to load the noise suppression processor: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const node = new AudioWorkletNode(context, 'clearvoice-noise-suppressor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: 'explicit',
      channelInterpretation: 'discrete',
      processorOptions: params,
    });
    node.onprocessorerror = () => {
      throw new AudioEngineError('worklet-load-failed', 'The noise suppression processor reported an error.');
    };
    return new NoiseSuppressor(node, { ...params });
  }

  get currentStats(): NoiseStats {
    return this.stats;
  }

  setParams(partial: Partial<NoiseParams>): void {
    const clean: Record<string, number | boolean> = {};
    for (const [key, value] of Object.entries(partial)) {
      if (typeof value === 'number' && isFinite(value)) clean[key] = value;
      else if (typeof value === 'boolean') clean[key] = value;
    }
    this.params = { ...this.params, ...clean };
    this.node.port.postMessage({ type: 'params', params: clean });
  }

  getParams(): NoiseParams {
    return { ...this.params };
  }

  /** Requests an aligned original/enhanced snapshot of `seconds` of audio. */
  capture(seconds = 2): void {
    this.node.port.postMessage({ type: 'capture', seconds });
  }

  reset(): void {
    this.node.port.postMessage({ type: 'reset' });
  }

  onStats(listener: StatsListener): () => void {
    this.statsListeners.add(listener);
    return () => this.statsListeners.delete(listener);
  }

  onCapture(listener: CaptureListener): () => void {
    this.captureListeners.add(listener);
    return () => this.captureListeners.delete(listener);
  }

  dispose(): void {
    this.statsListeners.clear();
    this.captureListeners.clear();
    this.node.port.onmessage = null;
    try {
      this.node.disconnect();
    } catch {
      /* already disconnected */
    }
  }
}
