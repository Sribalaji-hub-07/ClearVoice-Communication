import { SlidersHorizontal, Waves, ZapOff } from 'lucide-react';
import type { NoiseParams } from '../types/audio';

interface Props {
  params: NoiseParams;
  disabled: boolean;
  onChange: (partial: Partial<NoiseParams>) => void;
  onStrength: (strength: number) => void;
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  disabled,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  disabled: boolean;
  onChange: (v: number) => void;
  hint?: string;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div className="field">
      <div className="label">
        <span title={hint}>{label}</span>
        <span className="mono">
          {value}
          {unit ?? ''}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={{ ['--fill' as string]: `${fill}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function NoiseControls({ params, disabled, onChange, onStrength }: Props) {
  return (
    <div className="stack">
      <div className="card">
        <div className="card-title">
          <Waves size={14} /> Noise reduction strength
        </div>
        <Slider
          label="Overall strength"
          value={params.reductionStrength}
          min={0}
          max={100}
          step={1}
          unit="%"
          disabled={disabled}
          onChange={onStrength}
          hint="Drives the over-subtraction factor and the spectral floor below."
        />
        <div className="faint" style={{ marginTop: 8 }}>
          Strength writes to the real DSP parameters shown underneath; the sliders stay in sync with the
          worklet and are what actually process the audio.
        </div>

        <div className="divider" />

        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="label">
            <span className="mono">{params.overSubtraction.toFixed(2)} x</span>
          </div>
          <label className="switch">
            <input type="checkbox" checked={params.bypass} disabled={disabled} onChange={(e) => onChange({ bypass: e.target.checked })} />
            <span className="row tight">
              <ZapOff size={14} /> Bypass filter
            </span>
          </label>
        </div>
        <div className="faint">Over-subtraction (alpha) &middot; bypass sends the raw microphone through</div>
      </div>

      <div className="card">
        <div className="card-title">
          <SlidersHorizontal size={14} /> Algorithm parameters
        </div>
        <div className="stack" style={{ gap: 14 }}>
          <Slider
            label="Over-subtraction factor (alpha)"
            value={params.overSubtraction}
            min={0.5}
            max={4}
            step={0.05}
            disabled={disabled}
            onChange={(v) => onChange({ overSubtraction: v })}
            hint="Noise magnitude subtracted from the noisy magnitude."
          />
          <Slider
            label="Spectral floor"
            value={params.spectralFloor}
            min={0.005}
            max={0.3}
            step={0.005}
            disabled={disabled}
            onChange={(v) => onChange({ spectralFloor: v })}
            hint="Lower bound of the enhanced magnitude, as a fraction of the noisy magnitude."
          />
          <Slider
            label="Noise estimation smoothing"
            value={params.noiseSmoothing}
            min={0.7}
            max={0.995}
            step={0.005}
            disabled={disabled}
            onChange={(v) => onChange({ noiseSmoothing: v })}
            hint="Tracker time constant for the noise spectrum. Higher adapts more slowly."
          />
          <Slider
            label="Speech preservation"
            value={params.speechPreservation}
            min={0}
            max={0.9}
            step={0.01}
            disabled={disabled}
            onChange={(v) => onChange({ speechPreservation: v })}
            hint="Blend of the original magnitude restored in high-SNR bins."
          />
          <Slider
            label="Attack"
            value={params.attackMs}
            min={1}
            max={60}
            step={1}
            unit=" ms"
            disabled={disabled}
            onChange={(v) => onChange({ attackMs: v })}
            hint="How quickly suppression engages when noise appears."
          />
          <Slider
            label="Release"
            value={params.releaseMs}
            min={20}
            max={400}
            step={5}
            unit=" ms"
            disabled={disabled}
            onChange={(v) => onChange({ releaseMs: v })}
            hint="How quickly gain returns after the noise stops. Long releases avoid warble."
          />
          <Slider
            label="VAD threshold"
            value={params.vadThreshold}
            min={0.05}
            max={0.9}
            step={0.01}
            disabled={disabled}
            onChange={(v) => onChange({ vadThreshold: v })}
            hint="Speech probability needed before the noise tracker freezes."
          />
        </div>
      </div>
    </div>
  );
}
