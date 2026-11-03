import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { AudioEngine } from '../audio/AudioEngine';
import { strengthToParams } from '../audio/audioUtils';
import type { EngineSnapshot, NoiseParams } from '../types/audio';
import { EMPTY_STATS } from '../types/audio';

let sharedEngine: AudioEngine | null = null;

/** One engine for the whole app: the processed stream is shared with WebRTC. */
export function getAudioEngine(): AudioEngine {
  if (!sharedEngine) sharedEngine = new AudioEngine();
  return sharedEngine;
}

export interface UseAudioEngine {
  snapshot: EngineSnapshot;
  error: string | null;
  starting: boolean;
  start: (deviceId?: string) => Promise<void>;
  stop: () => Promise<void>;
  setParams: (partial: Partial<NoiseParams>) => void;
  applyStrength: (strength: number) => void;
  setBypass: (bypass: boolean) => void;
  setMuted: (muted: boolean) => void;
  setMonitor: (on: boolean) => void;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  recordings: { originalUrl: string | null; enhancedUrl: string | null; bytes: number; takenAt: number } | null;
  capture: (seconds: number) => void;
  engine: AudioEngine;
}

export function useAudioEngine(): UseAudioEngine {
  const engine = getAudioEngine();
  const snapshot = useSyncExternalStore(
    useCallback((onChange) => engine.onState(onChange), [engine]),
    () => engine.getSnapshot(),
  );
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [recordings, setRecordings] = useState<UseAudioEngine['recordings']>(null);

  useEffect(() => engine.onError((err) => setError(`${err.code}: ${err.message}`)), [engine]);

  const start = useCallback(
    async (deviceId?: string) => {
      setError(null);
      setStarting(true);
      try {
        await engine.start(deviceId);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to start audio capture.');
        throw err;
      } finally {
        setStarting(false);
      }
    },
    [engine],
  );

  const stop = useCallback(async () => {
    await engine.stop();
  }, [engine]);

  // Never leave the microphone running when the app unmounts.
  useEffect(
    () => () => {
      void engine.stop();
    },
    [engine],
  );

  const applyStrength = useCallback(
    (strength: number) => {
      engine.setParams({ ...strengthToParams(strength), reductionStrength: strength });
    },
    [engine],
  );

  const startRecording = useCallback(async () => {
    engine.startRecording();
  }, [engine]);

  const stopRecording = useCallback(async () => {
    const taken = await engine.stopRecording();
    setRecordings((previous) => {
      if (previous?.originalUrl) URL.revokeObjectURL(previous.originalUrl);
      if (previous?.enhancedUrl) URL.revokeObjectURL(previous.enhancedUrl);
      if (!taken.original && !taken.enhanced) return null;
      return {
        originalUrl: taken.original ? URL.createObjectURL(taken.original) : null,
        enhancedUrl: taken.enhanced ? URL.createObjectURL(taken.enhanced) : null,
        bytes: (taken.original?.size ?? 0) + (taken.enhanced?.size ?? 0),
        takenAt: Date.now(),
      };
    });
  }, [engine]);

  const capture = useCallback(
    (seconds: number) => engine.captureForEvaluation(seconds),
    [engine],
  );

  return {
    snapshot,
    error,
    starting,
    start,
    stop,
    setParams: (partial) => engine.setParams(partial),
    applyStrength,
    setBypass: (bypass) => engine.setBypass(bypass),
    setMuted: (muted) => engine.setMuted(muted),
    setMonitor: (on) => engine.setMonitor(on),
    startRecording,
    stopRecording,
    recordings,
    capture,
    engine,
  };
}

/** Subscribes to the aligned original/enhanced snapshots the worklet emits on request. */
export function useEvaluationCapture(seconds = 2) {
  const engine = getAudioEngine();
  const [result, setResult] = useState<{ original: Float32Array; enhanced: Float32Array; sampleRate: number; seconds: number } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => engine.onCapture((capture) => {
    setResult(capture);
    setBusy(false);
  }), [engine]);

  const request = useCallback(() => {
    if (!engine.running) return;
    setBusy(true);
    engine.captureForEvaluation(seconds);
  }, [engine, seconds]);

  return { result, busy, request, stats: engine.currentStats ?? EMPTY_STATS };
}
