export interface CallRecord {
  peerId: string;
  peerName: string;
  direction: 'in' | 'out';
  startedAt: number;
  endedAt: number;
  durationMs: number;
  endReason: string;
}

const KEY = 'clearvoice.callHistory';
const LIMIT = 8;

function read(): CallRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CallRecord[]).filter((r) => typeof r?.startedAt === 'number') : [];
  } catch {
    return [];
  }
}

/** Local-only call log for the dashboard. Nothing is uploaded. */
export function recordCall(entry: Omit<CallRecord, 'endedAt' | 'durationMs'>): void {
  const endedAt = Date.now();
  const list = [{ ...entry, endedAt, durationMs: Math.max(0, endedAt - entry.startedAt) }, ...read()].slice(0, LIMIT);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage disabled */
  }
}

export function recentCalls(): CallRecord[] {
  return read();
}

export function clearCalls(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage disabled */
  }
}
