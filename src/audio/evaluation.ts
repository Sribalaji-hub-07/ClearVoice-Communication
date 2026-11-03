import type { CaptureResult } from './NoiseSuppressor';

/**
 * Reference-free objective measures computed from the aligned original/enhanced
 * buffers the worklet captures. Used by the evaluation page and the results table.
 *
 * These are estimates derived from the signal itself, not PESQ/STOI. Without a clean
 * reference those two cannot be computed in the browser, so the UI labels them as
 * unavailable unless an external tool is used on the exported WAV files.
 */

export interface BufferMetrics {
  /** Seconds of audio analysed. */
  durationSec: number;
  /** Frame length used for the statistics. */
  frameMs: number;
  /** Overall RMS in dBFS. */
  rmsDb: number;
  /** Peak in dBFS. */
  peakDb: number;
  /** Estimated noise floor in dBFS (10th percentile frame energy). */
  noiseFloorDb: number;
  /** Estimated speech level in dBFS (frames at least 6 dB above the floor). */
  speechLevelDb: number;
  /** Reference-free SNR estimate in dB; NaN when the floor is digital silence. */
  snrDb: number;
  /** Spectral flatness, 0 = tonal, 1 = noise-like. */
  flatness: number;
  /** Fraction of frames classified as active (above floor + 6 dB). */
  activeFrameRatio: number;
}

export interface ComparisonResult {
  original: BufferMetrics;
  enhanced: BufferMetrics;
  snrImprovementDb: number;
  noiseFloorReductionDb: number;
  activeSpeechEnergyChangeDb: number;
  flatnessChange: number;
  originalLatencyMs: number;
  enhancedLatencyMs: number;
}

const FRAME_MS = 20;

/**
 * A frame-energy floor this low is digital silence rather than a real microphone noise
 * floor, and an SNR computed against it (190 dB and similar) is a number with no meaning.
 */
const MIN_MEASURABLE_FLOOR_DB = -110;

function frameEnergy(samples: Float32Array, frameSize: number): number[] {
  const out: number[] = [];
  for (let start = 0; start + frameSize <= samples.length; start += frameSize) {
    let sum = 0;
    for (let i = 0; i < frameSize; i++) {
      const v = samples[start + i];
      sum += v * v;
    }
    out.push(Math.sqrt(sum / frameSize));
  }
  return out;
}

function percentile(sortedAsc: number[], q: number): number {
  if (!sortedAsc.length) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.round(q * (sortedAsc.length - 1))));
  return sortedAsc[idx];
}

function toDb(value: number): number {
  return 20 * Math.log10(value + 1e-9);
}

function peakOf(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }
  return peak;
}

/** Compact radix-2 FFT used only for the flatness measure on a handful of frames. */
function magnitudeSpectrum(frame: Float32Array): Float32Array {
  const n = frame.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = frame[i];

  for (let i = 0, j = 0; i < n; i++) {
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
    let m = n >> 1;
    while (m >= 1 && j >= m) {
      j -= m;
      m >>= 1;
    }
    j += m;
  }

  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const angle = (-2 * Math.PI) / size;
    for (let i = 0; i < n; i += size) {
      for (let j = i, k = 0; j < i + half; j++, k++) {
        const wr = Math.cos(angle * k);
        const wi = Math.sin(angle * k);
        const l = j + half;
        const tr = re[l] * wr - im[l] * wi;
        const ti = re[l] * wi + im[l] * wr;
        re[l] = re[j] - tr;
        im[l] = im[j] - ti;
        re[j] += tr;
        im[j] += ti;
      }
    }
  }

  const bins = n / 2;
  const mag = new Float32Array(bins);
  for (let k = 0; k < bins; k++) mag[k] = Math.hypot(re[k], im[k]);
  return mag;
}

/** Geometric mean over arithmetic mean of the spectrum, averaged across frames. */
function spectralFlatness(samples: Float32Array, sampleRate: number): number {
  const n = Math.min(1024, nextPow2(Math.floor(sampleRate * 0.046)));
  const frames = Math.max(1, Math.min(24, Math.floor(samples.length / n)));
  const window = new Float32Array(n);
  for (let i = 0; i < n; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  const frame = new Float32Array(n);
  let total = 0;
  let used = 0;
  const hop = Math.floor(samples.length / frames) - n > 0 ? Math.floor(samples.length / frames) : n;
  for (let f = 0; f < frames; f++) {
    const start = f * hop;
    if (start + n > samples.length) break;
    for (let i = 0; i < n; i++) frame[i] = samples[start + i] * window[i];
    const mag = magnitudeSpectrum(frame);
    let logSum = 0;
    let linSum = 0;
    for (let k = 1; k < mag.length; k++) {
      logSum += Math.log(mag[k] + 1e-9);
      linSum += mag[k];
    }
    const bins = mag.length - 1;
    const geo = Math.exp(logSum / bins);
    const arith = linSum / bins;
    total += geo / (arith + 1e-9);
    used++;
  }
  return used ? total / used : 0;
}

function nextPow2(v: number): number {
  let n = 1;
  while (n < v) n <<= 1;
  return n;
}

export function analyzeBuffer(samples: Float32Array, sampleRate: number): BufferMetrics {
  const frameSize = Math.max(1, Math.round((sampleRate * FRAME_MS) / 1000));
  const energies = frameEnergy(samples, frameSize);
  const sorted = [...energies].sort((a, b) => a - b);
  const floorRms = percentile(sorted, 0.1);
  const threshold = floorRms * Math.pow(10, 6 / 20);

  let activeSum = 0;
  let activeCount = 0;
  let floorSum = 0;
  let floorCount = 0;
  let totalSum = 0;
  for (const e of energies) {
    totalSum += e * e;
    if (e >= threshold) {
      activeSum += e * e;
      activeCount++;
    } else {
      floorSum += e * e;
      floorCount++;
    }
  }
  const activeRms = activeCount ? Math.sqrt(activeSum / activeCount) : 0;
  const floorActual = floorCount ? Math.sqrt(floorSum / floorCount) : floorRms;
  const overall = energies.length ? Math.sqrt(totalSum / energies.length) : 0;
  const floorDb = toDb(floorActual);
  const activeDb = toDb(activeRms);
  // An SNR needs both populations. Against a silent floor, or with no frame above the
  // activity gate, the subtraction produces a huge number that measures nothing.
  const snrMeasurable = floorDb >= MIN_MEASURABLE_FLOOR_DB && activeCount > 0 && floorCount > 0;

  return {
    durationSec: samples.length / sampleRate,
    frameMs: FRAME_MS,
    rmsDb: toDb(overall),
    peakDb: toDb(peakOf(samples)),
    noiseFloorDb: floorDb,
    speechLevelDb: activeCount ? activeDb : NaN,
    snrDb: snrMeasurable ? activeDb - floorDb : NaN,
    flatness: spectralFlatness(samples, sampleRate),
    activeFrameRatio: energies.length ? activeCount / energies.length : 0,
  };
}

export function compare(original: Float32Array, enhanced: Float32Array, sampleRate: number, latencyMs: number): ComparisonResult {
  const a = analyzeBuffer(original, sampleRate);
  const b = analyzeBuffer(enhanced, sampleRate);
  return {
    original: a,
    enhanced: b,
    snrImprovementDb: b.snrDb - a.snrDb,
    noiseFloorReductionDb: a.noiseFloorDb - b.noiseFloorDb,
    activeSpeechEnergyChangeDb: b.speechLevelDb - a.speechLevelDb,
    flatnessChange: b.flatness - a.flatness,
    originalLatencyMs: 0,
    enhancedLatencyMs: latencyMs,
  };
}

export function compareCapture(capture: CaptureResult, latencyMs: number): ComparisonResult {
  return compare(capture.original, capture.enhanced, capture.sampleRate, latencyMs);
}

/** A single row of the results table required by the project specification. */
export interface ResultRow {
  condition: string;
  originalSnrDb: number;
  enhancedSnrDb: number;
  snrImprovementDb: number;
  noiseFloorReductionDb: number;
  speechEnergyChangeDb: number;
  processingDelayMs: number;
  observation: string;
}

export function toResultRow(condition: string, result: ComparisonResult, observation: string): ResultRow {
  return {
    condition,
    originalSnrDb: result.original.snrDb,
    enhancedSnrDb: result.enhanced.snrDb,
    snrImprovementDb: result.snrImprovementDb,
    noiseFloorReductionDb: result.noiseFloorReductionDb,
    speechEnergyChangeDb: result.activeSpeechEnergyChangeDb,
    processingDelayMs: result.enhancedLatencyMs,
    observation,
  };
}
