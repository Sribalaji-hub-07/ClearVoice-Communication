import type { ReactNode } from 'react';

type Tone = 'online' | 'offline' | 'busy' | 'live' | 'error' | 'idle';

const TONE_LABEL: Record<Tone, string> = {
  online: 'Online',
  offline: 'Offline',
  busy: 'Busy',
  live: 'Live',
  error: 'Error',
  idle: 'Idle',
};

interface Props {
  tone: Tone;
  pulse?: boolean;
  children?: ReactNode;
  label?: string;
}

export function StatusPill({ tone, pulse, children, label }: Props) {
  return (
    <span className={`pill ${tone === 'idle' ? '' : tone} ${pulse ? 'pulse' : ''}`.trim()}>
      <span className="dot" />
      {children ?? label ?? TONE_LABEL[tone]}
    </span>
  );
}
