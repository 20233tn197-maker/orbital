export class SpaceAudio {
  constructor(volume = 0.45) { this.volume = volume; this.ctx = null; this.lastShot = 0; }
  unlock() {
    if (!this.ctx) {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      this.ctx = new Audio();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume * 0.5;
      this.master.connect(this.ctx.destination);
      this.engine = this.ctx.createOscillator();
      this.engine.type = 'sawtooth';
      this.engine.frequency.value = 38;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = 130;
      this.engineGain = this.ctx.createGain(); this.engineGain.gain.value = 0;
      this.engine.connect(filter).connect(this.engineGain).connect(this.master);
      this.engine.start();
      this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    this.ctx.resume().catch(() => {});
  }
  setVolume(value) { this.volume = value; if (this.master) this.master.gain.setTargetAtTime(value * 0.5, this.ctx.currentTime, 0.05); }
  flight(speed, boost, active) {
    if (!this.ctx) return;
    this.engine.frequency.setTargetAtTime(32 + speed * 0.6 + (boost ? 25 : 0), this.ctx.currentTime, 0.08);
    this.engineGain.gain.setTargetAtTime(active ? 0.015 + speed * 0.0005 : 0, this.ctx.currentTime, 0.1);
  }
  tone(start, end, length, level, type = 'sine') {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const oscillator = this.ctx.createOscillator(), gain = this.ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(start, t);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, end), t + length);
    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + length);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(t); oscillator.stop(t + length);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
  burst(length, level, frequency = 800) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const source = this.ctx.createBufferSource(), gain = this.ctx.createGain(), filter = this.ctx.createBiquadFilter();
    source.buffer = this.noise;
    filter.type = 'lowpass'; filter.frequency.value = frequency;
    gain.gain.setValueAtTime(level, t); gain.gain.exponentialRampToValueAtTime(0.001, t + length);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(t); source.stop(t + length);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
  }
  shot(kind) {
    if (kind === 'cannon') { this.tone(145, 30, 0.27, 0.25, 'sawtooth'); this.burst(0.22, 0.25, 1500); }
    else this.tone(730, 105, 0.065, 0.08, 'triangle');
  }
  hit() { this.tone(1000, 1600, 0.065, 0.11, 'sine'); }
  explosion(distance = 0) { const level = Math.max(0.025, 0.65 / (1 + distance / 35)); this.burst(0.85, level, 650); this.tone(85, 22, 0.6, level * 0.5); }
  kill() { this.tone(660, 880, 0.17, 0.16); setTimeout(() => this.tone(880, 1320, 0.2, 0.13), 90); }
}
