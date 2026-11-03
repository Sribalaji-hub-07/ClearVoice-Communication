import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { sessionStore, type SessionState } from '../services/sessionStore';
import type { UserInfo } from '../types/call';

export interface UseSocket extends SessionState {
  connect: () => Promise<void>;
  rename: (name: string) => void;
  disconnect: () => void;
  peers: UserInfo[];
  retryIn: number | null;
}

/**
 * Subscribes to the shared signaling session. Connects once on mount and retries
 * with backoff instead of opening a second socket.
 */
export function useSocket(autoConnect = true): UseSocket {
  const state = useSyncExternalStore(
    useCallback((onChange) => sessionStore.subscribe(onChange), []),
    () => sessionStore.getState(),
  );
  const [retryIn, setRetryIn] = useState<number | null>(null);

  const connect = useCallback(async () => {
    try {
      await sessionStore.connect();
      setRetryIn(null);
    } catch {
      setRetryIn(5);
    }
  }, []);

  useEffect(() => {
    if (!autoConnect) return;
    void connect();
  }, [autoConnect, connect]);

  useEffect(() => {
    if (retryIn === null) return;
    if (retryIn <= 0) {
      void connect();
      return;
    }
    const timer = window.setTimeout(() => setRetryIn((value) => (value === null ? null : value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [retryIn, connect]);

  const peers = state.directory.filter((peer) => peer.id !== state.userId);

  return {
    ...state,
    peers,
    connect,
    rename: (name: string) => sessionStore.rename(name),
    disconnect: () => sessionStore.disconnect(),
    retryIn,
  };
}
