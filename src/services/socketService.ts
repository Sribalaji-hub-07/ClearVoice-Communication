import { io, type Socket } from 'socket.io-client';
import type { IceServerConfig } from '../types/call';
import { SIGNAL } from '../types/call';

export interface RegisterReply {
  userId: string;
  name: string;
  iceServers: IceServerConfig[];
  ice: { stun: string; turnConfigured: boolean; note: string };
  directory: unknown[];
}

type AnyHandler = (payload: never) => void;

/**
 * Thin, single-instance wrapper around the Socket.IO client.
 * Keeping one module-level socket is what prevents duplicate listeners and
 * duplicate connections when React re-mounts a component.
 */
class SocketService {
  private socket: Socket | null = null;
  private url: string;
  private bound = new Map<string, Set<AnyHandler>>();

  constructor() {
    const configured = (import.meta.env.VITE_SIGNALING_URL || '').replace(/\/+$/, '');
    if (configured) {
      this.url = configured;
      return;
    }
    // Vite serves the app on :5173 while the signaling server listens on :3001, so the page
    // origin is the wrong guess in development. Production must set VITE_SIGNALING_URL.
    const devHost = import.meta.env.DEV && typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:3001` : '';
    this.url = devHost || (typeof window !== 'undefined' ? window.location.origin : '');
  }

  get isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  get id(): string | undefined {
    return this.socket?.id;
  }

  connect(existingId?: string, name?: string): Promise<RegisterReply> {
    if (this.socket?.connected) {
      return this.register(existingId, name);
    }
    this.socket = io(this.url, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 800,
      timeout: 10000,
    });

    this.applyBindings();

    return new Promise<RegisterReply>((resolve, reject) => {
      const socket = this.socket!;
      const onError = (err: Error) => reject(err);
      socket.once('connect_error', onError);
      socket.once('connect', () => {
        socket.off('connect_error', onError);
        this.register(existingId, name).then(resolve, reject);
      });
    });
  }

  private register(existingId?: string, name?: string): Promise<RegisterReply> {
    const socket = this.socket!;
    return new Promise<RegisterReply>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Signaling server did not answer the registration.')), 8000);
      socket.timeout(8000).emit(
        SIGNAL.REGISTER,
        { id: existingId, name: name || 'ClearVoice user' },
        (err: Error | null, reply: RegisterReply) => {
          clearTimeout(timer);
          if (err) return reject(new Error('Registration failed: the signaling server is unreachable.'));
          resolve(reply);
        },
      );
    });
  }

  on<T>(event: string, handler: (payload: T) => void): () => void {
    const stored = handler as unknown as AnyHandler;
    if (!this.bound.has(event)) this.bound.set(event, new Set());
    this.bound.get(event)!.add(stored);
    this.socket?.on(event, handler as (payload: T) => void);
    return () => this.off(event, handler);
  }

  off<T>(event: string, handler: (payload: T) => void): void {
    this.bound.get(event)?.delete(handler as unknown as AnyHandler);
    this.socket?.off(event, handler as (payload: T) => void);
  }

  emit(event: string, payload?: unknown): void {
    this.socket?.emit(event, payload);
  }

  /** Re-attaches every remembered listener after a reconnect replaces the socket. */
  private applyBindings(): void {
    if (!this.socket) return;
    for (const [event, handlers] of this.bound) {
      this.socket.off(event);
      for (const handler of handlers) this.socket.on(event, handler as unknown as (...args: unknown[]) => void);
    }
  }

  disconnect(): void {
    for (const [event, handlers] of this.bound) {
      for (const handler of handlers) this.socket?.off(event, handler as unknown as (...args: unknown[]) => void);
    }
    this.bound.clear();
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
  }
}

export const socketService = new SocketService();
