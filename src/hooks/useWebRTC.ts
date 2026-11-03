import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { callController, type CallState } from '../services/callController';
import { isWebRtcSupported } from '../services/webrtcService';
import { formatDuration } from '../audio/audioUtils';

export interface UseWebRtc extends CallState {
  supported: boolean;
  durationMs: number;
  durationLabel: string;
  dial: (toId: string) => void;
  accept: () => void;
  reject: () => void;
  hangup: () => void;
  toggleMute: () => void;
  clearFailure: () => void;
}

/**
 * Drives one call at a time against the shared CallController, and keeps the
 * call-duration clock running off the real connect timestamp.
 */
export function useWebRTC(trackProvider: () => MediaStreamTrack | null): UseWebRtc {
  const state = useSyncExternalStore(
    useCallback((onChange) => callController.subscribe(onChange), []),
    () => callController.getState(),
  );
  const [durationMs, setDurationMs] = useState(0);

  useEffect(() => {
    callController.bindTrackProvider(trackProvider);
    callController.bindSignaling();
  }, [trackProvider]);

  useEffect(() => {
    if (state.phase !== 'active' || !state.startedAt) {
      setDurationMs(0);
      return;
    }
    const startedAt = state.startedAt;
    setDurationMs(Date.now() - startedAt);
    const timer = window.setInterval(() => setDurationMs(Date.now() - startedAt), 500);
    return () => window.clearInterval(timer);
  }, [state.phase, state.startedAt]);

  return {
    ...state,
    supported: isWebRtcSupported(),
    durationMs,
    durationLabel: formatDuration(durationMs),
    dial: (toId: string) => callController.dial(toId.trim().toUpperCase()),
    accept: () => callController.accept(),
    reject: () => callController.reject(),
    hangup: () => callController.hangup(),
    toggleMute: () => callController.setMuted(!state.muted),
    clearFailure: () => callController.teardown('cleared'),
  };
}
