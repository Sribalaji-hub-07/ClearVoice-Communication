import type { AudioLevels } from '../types/audio';

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function levelsFromBuffer(buf: Float32Array): AudioLevels {
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i];
    sum += v * v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  const rms = Math.sqrt(sum / (buf.length || 1));
  return { rms, peak, db: toDb(rms) };
}

export function toDb(value: number): number {
  return 20 * Math.log10(value + 1e-9);
}

/** 0..1 meter value for a dBFS reading, floor mapped to -60 dB. */
export function dbToMeter(db: number, floorDb = -60): number {
  if (!isFinite(db)) return 0;
  return clamp((db - floorDb) / -floorDb, 0, 1);
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function formatDb(db: number): string {
  if (!isFinite(db) || db <= -119) return '--';
  return `${db > 0 ? '+' : ''}${db.toFixed(1)}`;
}

export function formatMs(ms: number, digits = 1): string {
  if (!isFinite(ms)) return '--';
  return ms.toFixed(digits);
}

/** Fixed-point rendering that shows '--' for a measure the signal could not support. */
export function formatNum(value: number, digits = 1): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '--';
}

/**
 * Maps the single "noise reduction strength" slider onto the real DSP parameters.
 * Kept here so the UI, the engine and the docs agree on one mapping.
 */
export function strengthToParams(strength: number): { overSubtraction: number; spectralFloor: number; vadThreshold: number } {
  const s = clamp(strength, 0, 100) / 100;
  return {
    overSubtraction: +(1.0 + s * 2.5).toFixed(2),
    spectralFloor: +(0.12 - s * 0.11).toFixed(3),
    vadThreshold: +(0.3 + s * 0.25).toFixed(2),
  };
}

/** Encodes a mono Float32 buffer as a 16-bit PCM WAV blob for offline analysis. */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = clamp(samples[i], -1, 1);
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
