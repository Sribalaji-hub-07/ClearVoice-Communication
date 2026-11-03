import { socketService, type RegisterReply } from './socketService';
import type { IceServerConfig, UserInfo } from '../types/call';
import { SIGNAL } from '../types/call';

export type SessionStatus = 'offline' | 'connecting' | 'online' | 'error';

export interface SessionState {
  status: SessionStatus;
  userId: string | null;
  name: string;
  directory: UserInfo[];
  iceServers: IceServerConfig[];
  turnConfigured: boolean;
  iceNote: string;
  error: string | null;
}

const ID_KEY = 'clearvoice.userId';
const NAME_KEY = 'clearvoice.displayName';

/**
 * Module-level singleton so React re-mounts can never open a second socket or
 * register a second set of listeners.
 */
class SessionStore {
  private listeners = new Set<() => void>();
  private snapshot: SessionState = {
    status: 'offline',
    userId: read(ID_KEY),
    name: read(NAME_KEY) || 'Operator',
    directory: [],
    iceServers: [],
    turnConfigured: false,
    iceNote: 'Not connected - STUN/TURN configuration unknown.',
    error: null,
  };
  private started = false;

  getState(): SessionState {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(patch: Partial<SessionState>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  async connect(): Promise<void> {
    if (this.started && this.snapshot.status === 'online') return;
    this.started = true;
    this.set({ status: 'connecting', error: null });

    try {
      const reply: RegisterReply = await socketService.connect(this.snapshot.userId || undefined, this.snapshot.name);
      write(ID_KEY, reply.userId);
      write(NAME_KEY, reply.name);
      this.set({
        status: 'online',
        userId: reply.userId,
        name: reply.name,
        iceServers: reply.iceServers,
        turnConfigured: reply.ice?.turnConfigured ?? false,
        iceNote: reply.ice?.note ?? '',
        directory: (reply.directory as UserInfo[]) || [],
      });
      this.bindOnce();
    } catch (err) {
      this.set({ status: 'error', error: err instanceof Error ? err.message : 'Signaling connection failed.' });
      throw err;
    }
  }

  private bound = false;
  private bindOnce(): void {
    if (this.bound) return;
    this.bound = true;
    socketService.on<UserInfo[]>(SIGNAL.DIRECTORY, (directory) => this.set({ directory }));
    socketService.on<{ code: string; message: string }>(SIGNAL.ERROR, (payload) =>
      this.set({ error: payload?.message ?? 'Signaling error' }),
    );
  }

  rename(name: string): void {
    const clean = name.trim().slice(0, 32) || 'Operator';
    write(NAME_KEY, clean);
    this.set({ name: clean });
    socketService.emit(SIGNAL.RENAME, { name: clean });
  }

  disconnect(): void {
    socketService.disconnect();
    this.bound = false;
    this.started = false;
    this.set({ status: 'offline', directory: [], error: null });
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode / storage disabled - keep going with an in-memory id */
  }
}

export const sessionStore = new SessionStore();
