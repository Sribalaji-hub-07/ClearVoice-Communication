/**
 * Headless self-test for the ClearVoice AudioWorklet processor.
 *
 * Runs the real worklet source (src/worklets/noise-suppressor-worklet.js) outside the
 * browser against synthetic motorcycle-scene mixtures, so the DSP is verified with
 * measured numbers before any UI test:
 *
 *   1. reconstruction test - bypass mode must reproduce the input (validates FFT, the
 *      sqrt-Hann weighted overlap-add, and the output path). The processor always high-passes
 *      its input, so the reference carries the same DC blocker.
 *   2. noise reduction test - reference-free SNR of the mixture versus the output, on speech
 *      scaled to -20 dBFS with each noise field scaled to a designed input SNR.
 *   3. processor accounting - measured noise floor, suppression, per-frame compute time and
 *      therefore whether the worklet can hold real-time on this machine.
 *
 * Usage: node tools/dsp-selftest.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const workletPath = join(here, '..', 'src', 'worklets', 'noise-suppressor-worklet.js');

const SR = 48000;
const BLOCK = 128;

/** Loads the worklet file with the minimal AudioWorklet globals it relies on. */
function loadProcessor() {
  const source = readFileSync(workletPath, 'utf8');
  let captured = null;
  const messages = [];

  class AudioWorkletProcessor {
    constructor() {
      this.port = { postMessage: (m) => messages.push(m), onmessage: null };
    }
  }
  const registerProcessor = (_name, cls) => {
    captured = cls;
  };

  // eslint-disable-next-line no-new-func
  new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', 'performance', source)(
    AudioWorkletProcessor,
    registerProcessor,
    SR,
    performance,
  );
  if (!captured) throw new Error('Worklet did not register a processor.');
  return { cls: captured, messages };
}

function deliverMessages(processor, messages, handler) {
  // the stub queues every postMessage; flush only the ones this processor produced
  const upto = messages.length;
  for (let i = processor.__flushed ?? 0; i < upto; i++) handler(messages[i]);
  processor.__flushed = upto;
}

/** Runs the processor over a mono Float32Array and returns the rendered output. */
function run(processor, input) {
  const output = new Float32Array(input.length);
  const stats = [];
  let captures = [];
  const handler = (msg) => {
    if (msg.type === 'stats') stats.push(msg);
    if (msg.type === 'capture-result') captures.push(msg);
  };
  processor.port.onmessage = (event) => handler(event.data);

  const inputs = [[new Float32Array(BLOCK)]];
  const outputs = [[new Float32Array(BLOCK)]];
  for (let start = 0; start + BLOCK <= input.length; start += BLOCK) {
    inputs[0][0].set(input.subarray(start, start + BLOCK));
    outputs[0][0].fill(0);
    const alive = processor.process(inputs, outputs, {});
    if (!alive) throw new Error('processor returned false before the end of the test signal');
    output.set(outputs[0][0], start);
    deliverMessages(processor, processor.__messages, handler);
  }
  return { output, stats, captures };
}

// ---------- test signals ----------

function speechSegment(seconds, amplitude = 0.22) {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f0 = 120 + 28 * Math.sin(2 * Math.PI * 0.7 * t) + 12 * Math.sin(2 * Math.PI * 2.3 * t);
    // syllabic envelope with pauses so noise-only stretches exist
    const syllable = Math.max(0, Math.sin(2 * Math.PI * 1.9 * t)) ** 0.6;
    const gate = Math.sin(2 * Math.PI * 0.35 * t) > -0.15 ? 1 : 0;
    const env = syllable * gate * amplitude;
    let sample = 0;
    for (let h = 1; h <= 16; h++) {
      const formant = Math.exp(-((h * f0 - 900) ** 2) / (2 * 500 ** 2)) + 0.55 * Math.exp(-((h * f0 - 2400) ** 2) / (2 * 700 ** 2));
      sample += (formant / h) * Math.sin((2 * Math.PI * f0 * h * i) / SR);
    }
    out[i] = env * sample * 0.11 + env * 0.002 * Math.sin(2 * Math.PI * 5000 * t);
  }
  return out;
}

function windNoise(seconds, level = 0.1) {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const white = Math.random() * 2 - 1;
    lp += 0.035 * (white - lp); // ~260 Hz one-pole -> wind rumble
    const gust = 0.7 + 0.3 * Math.sin((2 * Math.PI * 0.6 * i) / SR);
    out[i] = level * 2.6 * lp * gust;
  }
  return out;
}

function engineNoise(seconds, level = 0.07) {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const rpm = 1 + 0.04 * Math.sin(2 * Math.PI * 1.7 * t);
    let s = 0;
    for (let h = 1; h <= 9; h++) s += (Math.sin(2 * Math.PI * 95 * h * rpm * t) / h) * (h % 2 ? 1 : 0.6);
    out[i] = level * s * 0.5 + level * 0.35 * (Math.random() * 2 - 1) * 0.4;
  }
  return out;
}

function trafficNoise(seconds, level = 0.06) {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const white = Math.random() * 2 - 1;
    last = 0.72 * last + 0.28 * white; // mid-band colour
    const pass = 0.6 + 0.4 * Math.sin((2 * Math.PI * 0.9 * i) / SR);
    out[i] = level * 2.2 * last * pass;
  }
  return out;
}

function hornBursts(seconds, level = 0.05) {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const active = t % 3 < 0.45 ? 1 : 0;
    const env = active * Math.min(1, ((t % 3) / 0.06)) * Math.min(1, (0.45 - (t % 3)) / 0.06);
    out[i] = level * env * (Math.sin(2 * Math.PI * 660 * t) + 0.5 * Math.sin(2 * Math.PI * 990 * t));
  }
  return out;
}

/** Sum of the given tracks. */
function mix(...parts) {
  const len = Math.max(...parts.map((p) => p.length));
  const out = new Float32Array(len);
  for (const p of parts) for (let i = 0; i < p.length; i++) out[i] += p[i];
  return out;
}

// ---------- calibrated mixtures ----------

function rmsOf(samples) {
  let acc = 0;
  for (let i = 0; i < samples.length; i++) acc += samples[i] * samples[i];
  return Math.sqrt(acc / samples.length);
}

function scaleTo(samples, targetRms) {
  const current = rmsOf(samples);
  const gain = current > 0 ? targetRms / current : 0;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * gain;
  return out;
}

const SPEECH_RMS_DB = -20;
const DESIGNED_SNR_DB = 5;

/**
 * One speech track plus the scenario's noise sources, with the noise sum scaled to a
 * designed input SNR so "in SNR" in the table is a controlled quantity, not an accident
 * of hand-picked generator amplitudes.
 */
function buildMixture(scenario, seconds) {
  const speech = scaleTo(speechSegment(seconds), dbToRms(SPEECH_RMS_DB));
  const sources = scenario.noise.map((make) => make(seconds));
  const raw = sources.length ? mix(...sources) : new Float32Array(Math.round(seconds * SR));
  const targetNoiseRms = dbToRms(SPEECH_RMS_DB - DESIGNED_SNR_DB);
  const scaled = sources.length ? scaleTo(raw, targetNoiseRms) : raw;
  const selfNoiseRms = dbToRms(-92);
  const floor = new Float32Array(scaled.length);
  for (let i = 0; i < floor.length; i++) floor[i] = selfNoiseRms * (Math.random() * 2 - 1) * 1.732;
  const noiseless = sources.length === 0;
  return {
    input: noiseless ? mix(speech, floor) : mix(speech, scaled, floor),
    noiseless,
  };
}

function dbToRms(db) {
  return Math.pow(10, db / 20);
}

// ---------- reference-free metrics ----------

function frameRms(samples, frameSize) {
  const out = [];
  for (let s = 0; s + frameSize <= samples.length; s += frameSize) {
    let acc = 0;
    for (let i = 0; i < frameSize; i++) acc += samples[s + i] * samples[s + i];
    out.push(Math.sqrt(acc / frameSize));
  }
  return out;
}

function db(v) {
  return 20 * Math.log10(v + 1e-12);
}

function snrEstimate(samples) {
  const frames = frameRms(samples, Math.round((SR * 20) / 1000));
  const sorted = [...frames].sort((a, b) => a - b);
  const floor = sorted[Math.floor(0.1 * (sorted.length - 1))];
  const threshold = floor * Math.pow(10, 6 / 20);
  let speechAcc = 0;
  let speechCount = 0;
  let noiseAcc = 0;
  let noiseCount = 0;
  for (const f of frames) {
    if (f >= threshold) {
      speechAcc += f * f;
      speechCount++;
    } else {
      noiseAcc += f * f;
      noiseCount++;
    }
  }
  const speech = speechCount ? Math.sqrt(speechAcc / speechCount) : 0;
  const noise = noiseCount ? Math.sqrt(noiseAcc / noiseCount) : floor;
  const speechDb = db(speech);
  const noiseDb = db(noise);
  // Against a numerically-silent floor, or with no frame clearing the activity gate at all,
  // an SNR of +200 dB or -210 dB is arithmetic, not a measurement.
  const unmeasurable = noiseDb < -110 || speechCount === 0 || noiseCount === 0;
  return { snrDb: unmeasurable ? NaN : speechDb - noiseDb, speechDb, noiseDb, speechCount, noiseCount };
}

/**
 * The processor always high-passes its input (one-pole DC blocker, ~38 Hz corner), so the
 * reconstruction reference has to carry the same filter or the test measures the blocker
 * instead of the FFT/overlap-add path.
 */
function dcBlockSignal(x) {
  const out = new Float32Array(x.length);
  let dcy = 0;
  let dcx = 0;
  for (let i = 0; i < x.length; i++) {
    const y = 0.995 * dcy + x[i] - dcx;
    dcx = x[i];
    dcy = y;
    out[i] = y;
  }
  return out;
}

function bestDelayCorrelation(a, b, maxLag) {
  // normalised cross-correlation on a 0.5 s window
  const window = Math.min(a.length, Math.min(b.length, SR / 2));
  let best = { lag: 0, score: -Infinity };
  for (let lag = 0; lag <= maxLag; lag++) {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < window - lag; i++) {
      const x = a[i];
      const y = b[i + lag];
      dot += x * y;
      na += x * x;
      nb += y * y;
    }
    const score = dot / (Math.sqrt(na * nb) + 1e-12);
    if (score > best.score) best = { lag, score };
  }
  return best;
}

function rmseAligned(a, b, lag) {
  const window = Math.min(a.length, b.length - lag);
  let acc = 0;
  let ref = 0;
  for (let i = 0; i < window; i++) {
    const d = a[i] - b[i + lag];
    acc += d * d;
    ref += a[i] * a[i];
  }
  return { rmse: Math.sqrt(acc / window), relativeDb: db(Math.sqrt(acc / window)) - db(Math.sqrt(ref / window)) };
}

// ---------- run ----------

const { cls, messages } = loadProcessor();
const seconds = 6;
const scenarios = [
  { name: 'clean speech', noise: [], expectReduction: false },
  { name: 'speech + wind', noise: [windNoise], expectReduction: true },
  { name: 'speech + engine', noise: [engineNoise], expectReduction: true },
  { name: 'speech + traffic', noise: [trafficNoise], expectReduction: true },
  { name: 'speech + horn', noise: [hornBursts], expectReduction: true },
  {
    name: 'speech + wind + engine + traffic + horn',
    noise: [windNoise, engineNoise, trafficNoise, hornBursts],
    expectReduction: true,
  },
];

const rows = [];
let failures = 0;

// 1. bypass reconstruction
{
  const processor = new cls({ processorOptions: { bypass: true } });
  processor.__messages = messages; processor.__flushed = messages.length;
  const probe = mix(windNoise(3, 0.08), speechSegment(3));
  const { output, stats } = run(processor, probe);
  const ref = dcBlockSignal(probe);
  const { lag, score } = bestDelayCorrelation(ref, output, 1000);
  const { relativeDb } = rmseAligned(ref, output, lag);
  const last = stats[stats.length - 1];
  const ok = score > 0.995;
  if (!ok) failures++;
  console.log('\n[1] bypass reconstruction (validates FFT + sqrt-Hann WOLA)');
  console.log(`    reference           : input after the processor's own DC blocker`);
  console.log(`    best-fit delay      : ${lag} samples (${((lag / SR) * 1000).toFixed(2)} ms)`);
  console.log(`    correlation         : ${score.toFixed(5)}`);
  console.log(`    residual vs input   : ${relativeDb.toFixed(1)} dB`);
  console.log(`    reported latency    : ${last ? last.algorithmLatencyMs.toFixed(2) : '?'} ms (N/fs)`);
  console.log(`    result              : ${ok ? 'PASS' : 'FAIL'} (correlation > 0.995)`);
}

// 2. noise reduction per scenario
const fmt = (v) => (Number.isFinite(v) ? v.toFixed(1) : ' n/m');
console.log('\n[2] adaptive spectral subtraction, measured on synthetic mixtures');
console.log(`    speech at ${SPEECH_RMS_DB} dBFS RMS, noise sum scaled to ${DESIGNED_SNR_DB} dB input SNR, -92 dBFS mic self-noise`);
console.log('    scenario                                  in SNR   out SNR   gain   speech kept');
for (const scenario of scenarios) {
  const { input } = buildMixture(scenario, seconds);
  const processor = new cls({
    processorOptions: {
      bypass: false,
      overSubtraction: 2,
      spectralFloor: 0.02,
      noiseSmoothing: 0.92,
      speechPreservation: 0.25,
      attackMs: 8,
      releaseMs: 120,
      vadThreshold: 0.4,
    },
  });
  processor.__messages = messages; processor.__flushed = messages.length;
  const { output, stats } = run(processor, input);
  const before = snrEstimate(input);
  const after = snrEstimate(output);
  const gain = after.snrDb - before.snrDb;
  const speechChange = after.speechDb - before.speechDb;
  const finite = Array.from(output).every((v) => Number.isFinite(v));
  if (!finite) {
    failures++;
    console.log('    FAIL: non-finite samples produced');
  }
  if (!Number.isFinite(before.snrDb) || !Number.isFinite(after.snrDb)) {
    failures++;
    console.log(`    FAIL: unmeasurable SNR for "${scenario.name}" - the floor is digital silence`);
  }
  // Acceptance: noise must drop by at least 3 dB, and the speech must not collapse.
  const limit = scenario.expectReduction ? 3 : -3;
  if (!(gain >= limit)) {
    failures++;
    console.log(`    FAIL: ${scenario.name} gained ${fmt(gain)} dB, needs >= ${limit}`);
  }
  if (speechChange < -8) {
    failures++;
    console.log(`    FAIL: ${scenario.name} lost ${fmt(speechChange)} dB of active-frame energy`);
  }
  rows.push({ scenario: scenario.name, before, after, gain, speechChange, finite, stats: stats[stats.length - 1] });
  console.log(
    `    ${scenario.name.padEnd(41)} ${fmt(before.snrDb).padStart(6)}  ${fmt(after.snrDb).padStart(7)}  ${fmt(gain)
      .padStart(6)}  ${fmt(speechChange).padStart(6)} dB`,
  );
}

// 3. convergence behaviour
{
  const row = rows[rows.length - 1];
  const stats = row.stats;
  console.log('\n[3] processor accounting for the combined mixture');
  console.log(`    frames processed     : ${stats.framesProcessed}`);
  console.log(`    measured floor       : ${stats.noiseFloorDb.toFixed(1)} dBFS -> ${stats.residualFloorDb.toFixed(1)} dBFS`);
  console.log(`    measured suppression : ${stats.suppressionDb.toFixed(1)} dB`);
  console.log(`    frame compute time   : ${stats.frameProcessingMs.toFixed(3)} ms per ${((256 / SR) * 1000).toFixed(2)} ms hop`);
  console.log(`    audio-thread CPU     : ${(stats.cpuLoad * 100).toFixed(1)}%`);
  console.log(`    limited samples      : ${stats.clipped}`);
  const realtime = stats.cpuLoad < 1;
  if (!realtime) failures++;
  console.log(`    real-time capable    : ${realtime ? 'PASS' : 'FAIL'}`);
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
