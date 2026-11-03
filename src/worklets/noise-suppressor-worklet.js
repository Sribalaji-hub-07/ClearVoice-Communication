/**
 * ClearVoice - STFT adaptive spectral subtraction processor (AudioWorklet).
 *
 * Chain per frame: DC blocker -> Hann framing (50% overlap) -> FFT -> biased-minima
 * noise estimation -> VAD -> spectral subtraction -> speech preservation ->
 * median + attack/release gain smoothing -> inverse FFT -> overlap-add.
 *
 * Loaded through audioWorklet.addModule(), so it must stay self-contained.
 * Keep FFT_SIZE / HOP_SIZE in sync with src/types/audio.ts.
 */

const FFT_SIZE = 512;
const HOP_SIZE = 256;
const BIN_COUNT = FFT_SIZE / 2 + 1;
const RENDER_QUANTUM = 128;

// The window is sqrt-Hann, so w[n]^2 + w[n+HOP]^2 = 1 exactly: weighted overlap-add
// reconstructs at unity gain with no amplitude modulation.
const OLA_SCALE = 1;

const TWO_PI = Math.PI * 2;
const EPS = 1e-9;

const SPEECH_LO_HZ = 90;
const SPEECH_HI_HZ = 4200;

/** Biases the tracked minima upward every window so rising noise is followed. */
const MIN_BIAS = 0.25;
/** Decision-directed smoothing of the a priori SNR. */
const DD_SMOOTH = 0.98;

class NoiseSuppressorProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.param = NoiseSuppressorProcessor.defaultParams();
    Object.assign(this.param, (options && options.processorOptions) || {});

    const rate = sampleRate || 48000;
    this.sampleRate = rate;
    this.hopSeconds = HOP_SIZE / rate;
    this.hopBudgetMs = (HOP_SIZE / rate) * 1000;

    this.window = new Float32Array(FFT_SIZE);
    for (let n = 0; n < FFT_SIZE; n++) {
      this.window[n] = Math.sqrt(0.5 - 0.5 * Math.cos((TWO_PI * n) / FFT_SIZE));
    }

    const levels = Math.log2(FFT_SIZE);
    this.rev = new Uint16Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) {
      let x = i;
      let r = 0;
      for (let b = 0; b < levels; b++) {
        r = (r << 1) | (x & 1);
        x >>= 1;
      }
      this.rev[i] = r;
    }
    this.twCos = new Float32Array(FFT_SIZE / 2);
    this.twSin = new Float32Array(FFT_SIZE / 2);
    for (let i = 0; i < FFT_SIZE / 2; i++) {
      this.twCos[i] = Math.cos((TWO_PI * i) / FFT_SIZE);
      this.twSin[i] = Math.sin((TWO_PI * i) / FFT_SIZE);
    }

    this.re = new Float64Array(FFT_SIZE);
    this.im = new Float64Array(FFT_SIZE);
    this.mag = new Float32Array(BIN_COUNT);
    this.noiseMag = new Float32Array(BIN_COUNT);
    this.smoothMag = new Float32Array(BIN_COUNT);
    this.minMag = new Float32Array(BIN_COUNT);
    this.meanMag = new Float32Array(BIN_COUNT);
    this.apriori = new Float32Array(BIN_COUNT);
    this.gainTarget = new Float32Array(BIN_COUNT);
    this.gain = new Float32Array(BIN_COUNT);
    this.gainPrev = new Float32Array(BIN_COUNT);
    this.gain.fill(1);
    this.gainPrev.fill(1);

    this.binLo = Math.max(1, Math.round((SPEECH_LO_HZ * FFT_SIZE) / rate));
    this.binHi = Math.min(BIN_COUNT - 1, Math.round((SPEECH_HI_HZ * FFT_SIZE) / rate));
    this.speechBandBins = Math.max(1, this.binHi - this.binLo + 1);
    this.minWindowFrames = Math.max(1, Math.round(0.64 / this.hopSeconds));
    this.minAge = 0;

    // Frame in progress: [0, HOP) is the previous half kept from the last slide,
    // [HOP, FFT) is filled with the newest samples.
    this.inputBuf = new Float32Array(FFT_SIZE);
    this.inPos = 0;
    this.primer = new Float32Array(HOP_SIZE);
    this.primerCount = 0;
    this.primed = false;

    // Accumulator holding the tail contributions for the samples about to be emitted.
    this.olaBuf = new Float32Array(HOP_SIZE);

    this.outFifo = new Float32Array(FFT_SIZE * 2);
    this.outWrite = 0;
    this.outRead = 0;
    this.outAvailable = 0;

    this.dcx = 0;
    this.dcy = 0;

    this.speechHold = 0;
    this.speechProb = 0;
    this.speechDetected = false;
    this.noiseFloorDb = -120;
    this.residualFloorDb = -120;
    this.avgGainDb = 0;
    this.frames = 0;
    this.procTimeSum = 0;
    this.procTimeCount = 0;
    this.clipped = 0;

    // Time-aligned history of (input, output) samples for the evaluation module.
    this.histLen = Math.round(rate * 4);
    this.histIn = new Float32Array(this.histLen);
    this.histOut = new Float32Array(this.histLen);
    this.histPos = 0;
    this.histFilled = 0;
    this.captureSeconds = 2;
    this.captureFrames = 0;

    this.statsEvery = Math.max(1, Math.round(0.05 / this.hopSeconds));
    this.port.onmessage = (event) => this.handleMessage(event.data);
  }

  static defaultParams() {
    return {
      overSubtraction: 2.0,
      spectralFloor: 0.02,
      noiseSmoothing: 0.92,
      speechPreservation: 0.25,
      attackMs: 8,
      releaseMs: 120,
      vadThreshold: 0.4,
      bypass: false,
    };
  }

  handleMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'params') {
      const incoming = msg.params || {};
      const defaults = NoiseSuppressorProcessor.defaultParams();
      for (const key of Object.keys(incoming)) {
        if (key in defaults) this.param[key] = incoming[key];
      }
    } else if (msg.type === 'capture') {
      this.captureSeconds = Math.min(4, Math.max(0.25, msg.seconds || 2));
      this.captureFrames = Math.max(1, Math.round((this.captureSeconds * this.sampleRate) / HOP_SIZE));
    } else if (msg.type === 'reset') {
      this.noiseMag.fill(0);
      this.smoothMag.fill(0);
      this.minMag.fill(0);
      this.meanMag.fill(0);
      this.apriori.fill(0);
      this.gain.fill(1);
      this.gainPrev.fill(1);
      this.histFilled = 0;
      this.histPos = 0;
      this.speechHold = 0;
      this.noiseFloorDb = -120;
      this.residualFloorDb = -120;
      this.frames = 0;
      this.clipped = 0;
    }
  }

  /**
   * One-pole DC blocker, pole 0.995, so a microphone offset cannot bias the spectrum.
   * The corner is -ln(0.995)*fs/2pi, i.e. about 38 Hz at 48 kHz and 29 Hz at 36 kHz -
   * below the voiced range, above true DC.
   */
  dcBlock(x) {
    const y = 0.995 * this.dcy + x - this.dcx;
    this.dcx = x;
    this.dcy = y;
    return y;
  }

  /** In-place radix-2 iterative FFT. sign = -1 forward, +1 inverse (scaled by 1/N). */
  fft(sign) {
    const N = FFT_SIZE;
    const rev = this.rev;
    const re = this.re;
    const im = this.im;

    for (let i = 0; i < N; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }

    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1;
      const step = N / size;
      for (let i = 0; i < N; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half;
          const c = this.twCos[k];
          const s = sign * this.twSin[k];
          const tr = re[l] * c - im[l] * s;
          const ti = re[l] * s + im[l] * c;
          re[l] = re[j] - tr;
          im[l] = im[j] - ti;
          re[j] += tr;
          im[j] += ti;
        }
      }
    }

    if (sign > 0) {
      const inv = 1 / N;
      for (let i = 0; i < N; i++) {
        re[i] *= inv;
        im[i] *= inv;
      }
    }
  }

  processFrame() {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const p = this.param;
    const N = FFT_SIZE;
    const win = this.window;

    // ---- Stage 3: STFT analysis ----
    for (let n = 0; n < N; n++) {
      this.re[n] = this.inputBuf[n] * win[n];
      this.im[n] = 0;
    }
    this.fft(-1);

    let logSum = 0;
    let linSum = 0;
    for (let k = this.binLo; k <= this.binHi; k++) {
      const m = Math.sqrt(this.re[k] * this.re[k] + this.im[k] * this.im[k]);
      this.mag[k] = m;
      logSum += Math.log(m + EPS);
      linSum += m;
    }
    for (let k = 0; k < this.binLo; k++) {
      this.mag[k] = Math.sqrt(this.re[k] * this.re[k] + this.im[k] * this.im[k]);
    }
    for (let k = this.binHi + 1; k < BIN_COUNT; k++) {
      this.mag[k] = Math.sqrt(this.re[k] * this.re[k] + this.im[k] * this.im[k]);
    }

    // ---- Stage 4: noise estimation ----
    // The minima of the smoothed magnitude are speech-immune; biasing them upward
    // each window is what lets the estimate chase wind and engine noise.
    const bandMean = linSum / this.speechBandBins;
    this.minAge++;
    const closeWindow = this.minAge >= this.minWindowFrames;
    for (let k = 0; k < BIN_COUNT; k++) {
      const m = this.mag[k];
      const prevSmooth = this.smoothMag[k];
      const s = prevSmooth === 0 ? m : 0.7 * prevSmooth + 0.3 * m;
      this.smoothMag[k] = s;
      this.meanMag[k] = 0.995 * this.meanMag[k] + 0.005 * s;

      const prevMin = this.minMag[k];
      if (prevMin === 0 || s < prevMin) this.minMag[k] = s;
      else if (closeWindow) {
        const bias = MIN_BIAS * this.meanMag[k];
        if (prevMin < bias) this.minMag[k] = bias;
      }

      const prev = this.noiseMag[k];
      if (this.speechDetected) {
        // Never let speech raise the floor: drift slowly toward the tracked minimum.
        this.noiseMag[k] = 0.995 * prev + 0.005 * this.minMag[k];
      } else {
        const obs = Math.min(s, prev * 2.5 + EPS);
        this.noiseMag[k] = p.noiseSmoothing * prev + (1 - p.noiseSmoothing) * obs;
      }
    }
    if (closeWindow) this.minAge = 0;

    // ---- VAD (flatness + segmental SNR against the tracked minimum) ----
    const flatness = Math.exp(logSum / this.speechBandBins) / (bandMean + EPS);
    let snrAcc = 0;
    for (let k = this.binLo; k <= this.binHi; k++) {
      snrAcc += this.smoothMag[k] / (this.minMag[k] + EPS);
    }
    const segSnr = snrAcc / this.speechBandBins;
    const snrScore = clamp01((10 * Math.log10(segSnr + EPS) - 3) / 12);
    const flatScore = clamp01((0.65 - flatness) / 0.45);
    this.speechProb = clamp01(0.62 * snrScore + 0.38 * flatScore);

    if (this.speechProb >= p.vadThreshold) {
      this.speechDetected = true;
      this.speechHold = Math.round(0.28 / this.hopSeconds);
    } else if (this.speechHold > 0) {
      this.speechHold--;
      this.speechDetected = true;
    } else {
      this.speechDetected = false;
    }

    // ---- Stage 5: adaptive spectral subtraction + speech preservation ----
    const alpha = p.overSubtraction;
    const floorRatio = p.spectralFloor;
    const presMax = p.speechPreservation;

    for (let k = 0; k < BIN_COUNT; k++) {
      const raw = this.mag[k];
      const nz = this.noiseMag[k];
      const instant = Math.max((raw * raw) / (nz * nz + EPS) - 1, 0.001);
      this.apriori[k] = DD_SMOOTH * this.apriori[k] + (1 - DD_SMOOTH) * instant;

      if (p.bypass) {
        this.gainTarget[k] = 1;
        continue;
      }
      // Enhanced Magnitude = max(Noisy Magnitude - alpha * Estimated Noise, Spectral Floor)
      const enhanced = Math.max(raw - alpha * nz, floorRatio * raw + EPS);
      const pres = presMax * (this.apriori[k] / (this.apriori[k] + 1));
      const finalMag = enhanced * (1 - pres) + raw * pres;
      this.gainTarget[k] = clampNum(finalMag / (raw + EPS), 0, 1);
    }

    // ---- Gain smoothing: 3-bin median (musical noise) then attack/release ----
    const atk = Math.exp(-this.hopSeconds / (Math.max(1, p.attackMs) / 1000));
    const rel = Math.exp(-this.hopSeconds / (Math.max(1, p.releaseMs) / 1000));
    let gainDbSum = 0;

    for (let k = 0; k < BIN_COUNT; k++) {
      const t = this.gainTarget[k];
      const lo = k > 0 ? this.gainTarget[k - 1] : t;
      const hi = k < BIN_COUNT - 1 ? this.gainTarget[k + 1] : t;
      const med = median3(t, lo, hi);
      const prev = this.gainPrev[k];
      const g = med < prev ? atk * prev + (1 - atk) * med : rel * prev + (1 - rel) * med;
      this.gain[k] = g;
      this.gainPrev[k] = g;
      if (k >= this.binLo && k <= this.binHi) gainDbSum += toDb(g);

      // A real gain keeps the original phase; restore Hermitian symmetry for the iFFT.
      this.re[k] *= g;
      this.im[k] *= g;
      if (k > 0 && k < BIN_COUNT - 1) {
        this.re[N - k] = this.re[k];
        this.im[N - k] = -this.im[k];
      }
    }
    this.avgGainDb = gainDbSum / this.speechBandBins;

    // ---- Stage 6: inverse STFT and overlap-add ----
    this.fft(1);

    let inEnergy = 0;
    let outEnergy = 0;
    for (let n = 0; n < HOP_SIZE; n++) {
      const sIn = this.inputBuf[n];
      inEnergy += sIn * sIn;
      const v = clampNum((this.olaBuf[n] + this.re[n] * win[n] * OLA_SCALE), -1, 1);
      if (v <= -0.999 || v >= 0.999) this.clipped++;
      outEnergy += v * v;
      this.writeOutput(v);
      this.recordHistory(sIn, v);
    }
    for (let n = 0; n < HOP_SIZE; n++) {
      this.olaBuf[n] = this.re[HOP_SIZE + n] * win[HOP_SIZE + n];
      this.inputBuf[n] = this.inputBuf[HOP_SIZE + n];
    }

    // ---- Measured reduction on non-speech frames (dBFS, time domain) ----
    if (!this.speechDetected) {
      const inDb = toDb(Math.sqrt(inEnergy / HOP_SIZE));
      const outDb = toDb(Math.sqrt(outEnergy / HOP_SIZE));
      if (this.noiseFloorDb <= -119) {
        this.noiseFloorDb = inDb;
        this.residualFloorDb = outDb;
      } else {
        this.noiseFloorDb = 0.9 * this.noiseFloorDb + 0.1 * inDb;
        this.residualFloorDb = 0.9 * this.residualFloorDb + 0.1 * outDb;
      }
    }

    this.frames++;
    if (t0) {
      this.procTimeSum += performance.now() - t0;
      this.procTimeCount++;
    }
    if (this.frames % this.statsEvery === 0) this.postStats();

    if (this.captureFrames > 0) {
      this.captureFrames--;
      if (this.captureFrames === 0) this.postCapture();
    }
  }

  writeOutput(v) {
    if (this.outAvailable >= this.outFifo.length) return;
    this.outFifo[this.outWrite] = v;
    this.outWrite = (this.outWrite + 1) % this.outFifo.length;
    this.outAvailable++;
  }

  recordHistory(inputSample, outputSample) {
    this.histIn[this.histPos] = inputSample;
    this.histOut[this.histPos] = outputSample;
    this.histPos = (this.histPos + 1) % this.histLen;
    if (this.histFilled < this.histLen) this.histFilled++;
  }

  pushInput(sample) {
    const filtered = this.dcBlock(sample);
    if (!this.primed) {
      this.primer[this.primerCount] = filtered;
      this.primerCount++;
      if (this.primerCount >= HOP_SIZE) {
        this.inputBuf.set(this.primer);
        this.primed = true;
        this.primerCount = 0;
      }
      return;
    }
    this.inputBuf[HOP_SIZE + this.inPos] = filtered;
    this.inPos++;
    if (this.inPos >= HOP_SIZE) {
      this.inPos = 0;
      this.processFrame();
    }
  }

  postStats() {
    const meanProcMs = this.procTimeCount ? this.procTimeSum / this.procTimeCount : 0;
    this.port.postMessage({
      type: 'stats',
      speechDetected: this.speechDetected,
      speechProbability: this.speechProb,
      noiseFloorDb: this.noiseFloorDb,
      residualFloorDb: this.residualFloorDb,
      suppressionDb: Math.max(0, this.noiseFloorDb - this.residualFloorDb),
      avgGainDb: this.avgGainDb,
      sampleRate: this.sampleRate,
      algorithmLatencyMs: (FFT_SIZE / this.sampleRate) * 1000,
      frameProcessingMs: meanProcMs,
      cpuLoad: meanProcMs / this.hopBudgetMs,
      framesProcessed: this.frames,
      clipped: this.clipped,
      bypass: this.param.bypass,
      timestamp: typeof performance !== 'undefined' ? performance.now() : 0,
    });
    this.procTimeSum = 0;
    this.procTimeCount = 0;
  }

  postCapture() {
    const want = Math.min(Math.round(this.captureSeconds * this.sampleRate), this.histFilled);
    const original = new Float32Array(want);
    const enhanced = new Float32Array(want);
    let src = (this.histPos - want + this.histLen * 2) % this.histLen;
    for (let i = 0; i < want; i++) {
      original[i] = this.histIn[src];
      enhanced[i] = this.histOut[src];
      src = (src + 1) % this.histLen;
    }
    this.port.postMessage(
      { type: 'capture-result', original, enhanced, sampleRate: this.sampleRate, seconds: want / this.sampleRate },
      [original.buffer, enhanced.buffer]
    );
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const chan = output[0];
    const input = inputs[0];
    const src = input && input[0] ? input[0] : null;
    const block = chan.length || RENDER_QUANTUM;

    for (let i = 0; i < block; i++) {
      this.pushInput(src ? src[i] : 0);
      if (this.outAvailable > 0) {
        chan[i] = this.outFifo[this.outRead];
        this.outRead = (this.outRead + 1) % this.outFifo.length;
        this.outAvailable--;
      } else {
        chan[i] = 0;
      }
    }
    return true;
  }
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clampNum(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function median3(a, b, c) {
  const mid = a + b + c - Math.max(a, Math.max(b, c)) - Math.min(a, Math.min(b, c));
  return mid;
}

function toDb(rms) {
  return 20 * Math.log10(rms + 1e-9);
}

registerProcessor('clearvoice-noise-suppressor', NoiseSuppressorProcessor);
