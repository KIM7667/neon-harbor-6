// audio.js - every sound in NEON HARBOR is synthesised with WebAudio; there are no
// audio files. One AudioContext, created lazily on the first user gesture (browsers
// refuse sound before that). Continuous sounds (the car engine, the police siren) are
// small oscillator rigs started and stopped by the game; the rest are one-shot blips.
//
// Nothing here throws when audio is unavailable: if the context cannot be created the
// game simply runs silent, which keeps the headless self-test happy.

export class SoundBank {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.engineNodes = null;
    this.sirenNodes = null;
  }

  /** Create (or resume) the context. Call from a click or key handler. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.ctx.currentTime, 0.03);
    }
  }

  /** A short oscillator tone with an envelope. */
  tone(freq, seconds, type = 'square', volume = 0.2, slideTo = null, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + seconds);
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + seconds);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + seconds + 0.02);
  }

  /** A burst of filtered noise - gunshots, punches, crashes. */
  noise(seconds, volume = 0.3, cutoff = 1200, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const length = Math.max(1, Math.floor(this.ctx.sampleRate * seconds));
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + seconds);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(t0);
  }

  gunshot() {
    this.noise(0.16, 0.5, 2600);
    this.tone(140, 0.1, 'triangle', 0.25, 55);
  }

  punch() {
    this.noise(0.09, 0.35, 700);
  }

  crash(intensity = 1) {
    this.noise(0.22, 0.3 * intensity, 900);
    this.tone(90, 0.18, 'sawtooth', 0.12 * intensity, 40);
  }

  horn() {
    this.tone(370, 0.28, 'square', 0.16);
    this.tone(466, 0.28, 'square', 0.12);
  }

  pickup() {
    this.tone(660, 0.09, 'sine', 0.22);
    this.tone(990, 0.14, 'sine', 0.22, null, 0.08);
  }

  cash() {
    this.tone(880, 0.07, 'triangle', 0.2);
    this.tone(1174, 0.07, 'triangle', 0.2, null, 0.07);
    this.tone(1568, 0.16, 'triangle', 0.2, null, 0.14);
  }

  failSting() {
    this.tone(392, 0.16, 'sawtooth', 0.16);
    this.tone(311, 0.16, 'sawtooth', 0.16, null, 0.15);
    this.tone(233, 0.34, 'sawtooth', 0.16, null, 0.3);
  }

  winJingle() {
    const notes = [523, 659, 784, 1046, 784, 1046];
    notes.forEach((freq, i) => this.tone(freq, 0.18, 'triangle', 0.22, null, i * 0.13));
  }

  click() {
    this.tone(1200, 0.04, 'square', 0.1);
  }

  /** Start the engine loop; pitch follows speed while driving. */
  engineStart() {
    if (!this.ctx || this.engineNodes) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 55;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.0;
    gain.gain.setTargetAtTime(0.07, this.ctx.currentTime, 0.1);
    osc.connect(filter).connect(gain).connect(this.master);
    osc.start();
    this.engineNodes = { osc, gain, filter };
  }

  engineUpdate(speedRatio) {
    if (!this.ctx || !this.engineNodes) return;
    const t = this.ctx.currentTime;
    this.engineNodes.osc.frequency.setTargetAtTime(55 + speedRatio * 130, t, 0.06);
    this.engineNodes.filter.frequency.setTargetAtTime(320 + speedRatio * 700, t, 0.06);
  }

  engineStop() {
    if (!this.ctx || !this.engineNodes) return;
    const { osc, gain } = this.engineNodes;
    gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    window.setTimeout(() => { try { osc.stop(); } catch { /* already stopped */ } }, 200);
    this.engineNodes = null;
  }

  /** Two-tone siren while any cruiser is hunting the player. */
  sirenStart() {
    if (!this.ctx || this.sirenNodes) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 700;
    const lfo = this.ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 0.9;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 160;
    lfo.connect(lfoGain).connect(osc.frequency);
    const gain = this.ctx.createGain();
    gain.gain.value = 0.0;
    gain.gain.setTargetAtTime(0.045, this.ctx.currentTime, 0.2);
    osc.connect(gain).connect(this.master);
    osc.start();
    lfo.start();
    this.sirenNodes = { osc, lfo, gain };
  }

  sirenStop() {
    if (!this.ctx || !this.sirenNodes) return;
    const { osc, lfo, gain } = this.sirenNodes;
    gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
    window.setTimeout(() => {
      try { osc.stop(); lfo.stop(); } catch { /* already stopped */ }
    }, 250);
    this.sirenNodes = null;
  }
}
