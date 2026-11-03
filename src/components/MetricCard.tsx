import type { ReactNode } from 'react';

interface Props {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: string;
  tone?: 'default' | 'good' | 'warn' | 'bad';
  icon?: ReactNode;
}

const TONE_CLASS: Record<NonNullable<Props['tone']>, string> = {
  default: '',
  good: 'pos',
  warn: '',
  bad: 'neg',
};

export function MetricCard({ label, value, unit, hint, tone = 'default', icon }: Props) {
  return (
    <div className="card" style={{ padding: 15 }}>
      <div className="metric-label" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        {icon}
        {label}
      </div>
      <div className={`metric-value ${TONE_CLASS[tone]}`.trim()}>
        {value}
        {unit ? <span className="metric-unit">{unit}</span> : null}
      </div>
      {hint ? <div className="faint" style={{ marginTop: 4 }}>{hint}</div> : null}
    </div>
  );
}
