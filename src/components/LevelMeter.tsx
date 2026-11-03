import { useEffect, useRef } from 'react';
import type { AudioEngine } from '../audio/AudioEngine';
import { dbToMeter } from '../audio/audioUtils';

interface Props {
  engine: AudioEngine;
  channel: 'original' | 'enhanced';
  label: string;
  running: boolean;
}

/**
 * Updates the bar width and the dBFS readout on every frame straight from the
 * AnalyserNode, without re-rendering React.
 */
export function LevelMeter({ engine, channel, label, running }: Props) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const valueRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    let frame = 0;
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      const levels = channel === 'enhanced' ? engine.readEnhancedLevels() : engine.readOriginalLevels();
      if (barRef.current) barRef.current.style.width = `${(dbToMeter(levels.db) * 100).toFixed(1)}%`;
      if (valueRef.current) {
        valueRef.current.textContent = running ? `${levels.db.toFixed(1)} dBFS` : '-- dBFS';
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
    };
  }, [engine, channel, running]);

  return (
    <div>
      <div className="label">
        <span>{label}</span>
        <span className="mono" ref={valueRef}>
          -- dBFS
        </span>
      </div>
      <div className="meter">
        <div ref={barRef} className={`meter-fill ${channel}`} style={{ width: '0%' }} />
      </div>
      <div className="meter-scale">
        <span>-60</span>
        <span>-40</span>
        <span>-20</span>
        <span>0 dBFS</span>
      </div>
    </div>
  );
}
