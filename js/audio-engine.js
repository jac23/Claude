// audio-engine.js
// Captures microphone audio, detects discrete sound events ("barks"), and
// measures acoustic features for each one using the Web Audio API.
//
// Detection strategy:
//   * Read time-domain + frequency-domain data every animation frame.
//   * Track short-term RMS energy. A rise above an adaptive threshold opens a
//     sound event; a fall below it (held for a short release time) closes it.
//   * While an event is open, accumulate peak loudness, dominant pitch (via
//     autocorrelation), and spectral flatness (tonality).
//   * Maintain a rolling log of recent event onsets to estimate repetition
//     rate (barks per second).

class AudioEngine {
  constructor({ onEvent, onLevel } = {}) {
    this.onEvent = onEvent || (() => {});
    this.onLevel = onLevel || (() => {});

    this.ctx = null;
    this.analyser = null;
    this.source = null;
    this.stream = null;
    this.rafId = null;

    this.timeBuf = null;
    this.freqBuf = null;

    // Event-detection state.
    this.inEvent = false;
    this.eventStart = 0;
    this.belowSince = 0;
    this.peakLoud = 0;
    this.pitchSamples = [];
    this.tonalitySamples = [];

    // Adaptive noise floor (exponential moving average of quiet RMS).
    this.noiseFloor = 0.01;
    this.recentOnsets = [];

    // Tunables.
    this.openThresholdMul = 3.0; // RMS must exceed floor * this to open
    this.closeThresholdMul = 1.8;
    this.releaseMs = 140; // silence needed to close an event
    this.minEventMs = 60; // ignore clicks shorter than this
    this.maxEventMs = 3000;
  }

  get isRunning() {
    return this.ctx !== null;
  }

  async start() {
    if (this.ctx) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.4;
    this.source.connect(this.analyser);

    this.timeBuf = new Float32Array(this.analyser.fftSize);
    this.freqBuf = new Float32Array(this.analyser.frequencyBinCount);

    this._tick = this._tick.bind(this);
    this.rafId = requestAnimationFrame(this._tick);
  }

  async stop() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.ctx) await this.ctx.close();
    this.ctx = null;
    this.analyser = null;
    this.source = null;
    this.inEvent = false;
  }

  _tick() {
    this.rafId = requestAnimationFrame(this._tick);
    const now = performance.now();

    this.analyser.getFloatTimeDomainData(this.timeBuf);
    const rms = computeRms(this.timeBuf);

    // Report a smoothed level for the meter (0..1-ish).
    this.onLevel(Math.min(1, rms * 6));

    const openThresh = this.noiseFloor * this.openThresholdMul;
    const closeThresh = this.noiseFloor * this.closeThresholdMul;

    if (!this.inEvent) {
      // Track the quiet background to adapt the noise floor.
      this.noiseFloor = this.noiseFloor * 0.995 + rms * 0.005;

      if (rms > openThresh && rms > 0.02) {
        this.inEvent = true;
        this.eventStart = now;
        this.peakLoud = rms;
        this.pitchSamples = [];
        this.tonalitySamples = [];
        this.belowSince = 0;
        this._sampleFrame(rms);
      }
    } else {
      this._sampleFrame(rms);
      this.peakLoud = Math.max(this.peakLoud, rms);

      if (rms < closeThresh) {
        if (this.belowSince === 0) this.belowSince = now;
        if (now - this.belowSince >= this.releaseMs) {
          this._closeEvent(now);
        }
      } else {
        this.belowSince = 0;
      }

      if (now - this.eventStart > this.maxEventMs) this._closeEvent(now);
    }
  }

  _sampleFrame(rms) {
    // Only bother with pitch/tonality on frames with real energy.
    if (rms < 0.015) return;
    this.analyser.getFloatFrequencyData(this.freqBuf);
    const pitch = detectPitch(this.timeBuf, this.ctx.sampleRate);
    if (pitch > 0) this.pitchSamples.push(pitch);
    this.tonalitySamples.push(spectralTonality(this.freqBuf));
  }

  _closeEvent(now) {
    const durationMs = now - this.eventStart;
    this.inEvent = false;
    this.belowSince = 0;

    if (durationMs < this.minEventMs) return; // too short, ignore

    // Repetition rate from recent onsets within a 2.5s window.
    this.recentOnsets.push(this.eventStart);
    const windowStart = now - 2500;
    this.recentOnsets = this.recentOnsets.filter((t) => t >= windowStart);
    const span =
      this.recentOnsets.length > 1
        ? (this.recentOnsets[this.recentOnsets.length - 1] -
            this.recentOnsets[0]) /
          1000
        : 0;
    const repetitionHz =
      span > 0 ? (this.recentOnsets.length - 1) / span : 0;

    const pitchHz = median(this.pitchSamples) || 500;
    const tonality = mean(this.tonalitySamples);

    this.onEvent({
      pitchHz,
      loudness: Math.min(1, this.peakLoud * 6),
      durationMs,
      repetitionHz,
      tonality,
      timestamp: Date.now(),
    });
  }
}

function computeRms(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

// Autocorrelation-based pitch detection. Returns fundamental in Hz, or -1.
function detectPitch(buf, sampleRate) {
  const size = buf.length;
  let rms = 0;
  for (let i = 0; i < size; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / size);
  if (rms < 0.01) return -1;

  // Search lags corresponding to 150 Hz .. 2500 Hz (dog bark range).
  const minLag = Math.floor(sampleRate / 2500);
  const maxLag = Math.floor(sampleRate / 150);

  let bestLag = -1;
  let bestCorr = 0;
  let lastCorr = 1;
  let foundGoodDip = false;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    for (let i = 0; i < size - lag; i++) corr += buf[i] * buf[i + lag];
    corr /= size - lag;

    if (corr > 0.5 && corr > lastCorr) {
      foundGoodDip = true;
    }
    if (foundGoodDip && corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
    lastCorr = corr;
  }

  if (bestLag <= 0) return -1;
  return sampleRate / bestLag;
}

// Spectral tonality proxy: geometric-mean / arithmetic-mean of the magnitude
// spectrum (a spectral-flatness measure). Returns 0 (noisy) .. 1 (tonal).
function spectralTonality(freqDb) {
  let geoLogSum = 0;
  let arithSum = 0;
  let n = 0;
  for (let i = 2; i < freqDb.length; i++) {
    // Convert dB back to a linear magnitude, guarding the floor.
    const mag = Math.pow(10, freqDb[i] / 20) + 1e-9;
    geoLogSum += Math.log(mag);
    arithSum += mag;
    n++;
  }
  if (n === 0 || arithSum === 0) return 0;
  const flatness = Math.exp(geoLogSum / n) / (arithSum / n); // 0..1
  return Math.min(1, Math.max(0, 1 - flatness)); // invert: high = tonal
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

window.AudioEngine = AudioEngine;
