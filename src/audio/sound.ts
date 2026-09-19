// All audio is synthesized with WebAudio: no audio files.
// Music: one loop = 4 bars at 96 BPM = 10s, exactly one game loop.
// Every living echo adds another layer to the track.

const STEPS_PER_LOOP = 64;
const STEP_SEC = 10 / STEPS_PER_LOOP;
const LOOKAHEAD_SEC = 0.12;
const MAX_LAYERS = 8;

// A minor: Am | F | C | G
const CHORDS = [
  [57, 60, 64],
  [53, 57, 60],
  [52, 55, 60],
  [55, 59, 62],
];
const BASS = [33, 29, 36, 31];
// Lead motif: [step within bar, midi note]
const LEAD: [number, number][][] = [
  [[0, 76], [6, 74], [8, 72], [12, 69]],
  [[0, 72], [4, 69], [8, 65], [14, 67]],
  [[0, 67], [6, 72], [8, 76], [12, 79]],
  [[0, 74], [4, 71], [8, 74], [10, 79], [12, 78]],
];

const LAYER_GAIN = [0.9, 0.35, 0.5, 0.45, 0.16, 0.14, 0.2, 0.1];

function mtof(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private musicFilter!: BiquadFilterNode;
  private sfxBus!: GainNode;
  private delay!: DelayNode;
  private layers: GainNode[] = [];
  private noise!: AudioBuffer;
  private timer: number | null = null;
  private loopStart = 0;
  private nextStep = 0;
  private playing = false;
  muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem("echo.muted") === "1";
    } catch {
      /* storage unavailable */
    }
  }

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(comp);

    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = "lowpass";
    this.musicFilter.frequency.value = 18000;
    this.musicFilter.connect(this.master);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.55;
    this.musicBus.connect(this.musicFilter);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.7;
    this.sfxBus.connect(this.master);

    // Shared echo-y delay for the sparkle layer and some sfx.
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = STEP_SEC * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.35;
    const wet = ctx.createGain();
    wet.gain.value = 0.4;
    this.delay.connect(fb);
    fb.connect(this.delay);
    this.delay.connect(wet);
    wet.connect(this.master);

    this.layers = LAYER_GAIN.map(() => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.musicBus);
      return g;
    });

    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem("echo.muted", this.muted ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.02);
    return this.muted;
  }

  pause() {
    if (this.ctx?.state === "running") void this.ctx.suspend();
  }

  resume() {
    if (this.ctx?.state === "suspended") void this.ctx.resume();
  }

  // ---------- Music ----------

  /** Start (or re-anchor) the music at the beginning of a game loop. */
  startLoop(ghosts: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    this.loopStart = ctx.currentTime + 0.01;
    this.nextStep = 0;
    this.setLayers(ghosts);
    this.musicFilter.frequency.cancelScheduledValues(ctx.currentTime);
    this.musicFilter.frequency.setTargetAtTime(18000, ctx.currentTime, 0.05);
    if (!this.playing) {
      this.playing = true;
      this.timer = window.setInterval(() => this.schedule(), 25);
    }
  }

  /** Layer count follows the number of living echoes. */
  setLayers(ghosts: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const n = Math.min(ghosts + 2, MAX_LAYERS);
    this.layers.forEach((g, i) => {
      g.gain.setTargetAtTime(i < n ? LAYER_GAIN[i] : 0, ctx.currentTime, i < n ? 0.05 : 0.25);
    });
  }

  stopMusic(dramatic = false) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.playing = false;
    const t = ctx.currentTime;
    if (dramatic) {
      // "Memory corrupted": the track drowns out.
      this.musicFilter.frequency.cancelScheduledValues(t);
      this.musicFilter.frequency.setValueAtTime(this.musicFilter.frequency.value, t);
      this.musicFilter.frequency.exponentialRampToValueAtTime(120, t + 1.2);
    }
    this.layers.forEach((g) => g.gain.setTargetAtTime(0, t, dramatic ? 0.5 : 0.08));
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx || !this.playing) return;
    while (this.nextStep < STEPS_PER_LOOP) {
      const time = this.loopStart + this.nextStep * STEP_SEC;
      if (time > ctx.currentTime + LOOKAHEAD_SEC) break;
      if (time >= ctx.currentTime - 0.05) this.playStep(this.nextStep, time);
      this.nextStep++;
    }
  }

  private playStep(step: number, t: number) {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const chord = CHORDS[bar];
    const L = this.layers;

    if (s % 4 === 0) this.kick(t, L[0]);
    if (s % 4 === 2) this.hat(t, L[1], 0.05);
    if (s % 2 === 0) this.bass(t, mtof(BASS[bar] + (s % 8 === 6 ? 12 : 0)), L[2]);
    if (s === 4 || s === 12) this.clap(t, L[3]);
    this.tone(t, mtof(chord[s % 3] + 12), STEP_SEC * 0.8, "square", L[4], 0.5, 2400);
    if (s === 0) for (const n of chord) this.pad(t, mtof(n), STEP_SEC * 16, L[5]);
    for (const [ls, n] of LEAD[bar]) if (ls === s) this.tone(t, mtof(n), STEP_SEC * 3.5, "triangle", L[6], 0.9);
    if (s % 2 === 1) this.tone(t, mtof(chord[(s >> 1) % 3] + 36), STEP_SEC * 0.6, "sine", L[7], 0.6, 0, true);
  }

  private kick(t: number, out: AudioNode) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    g.gain.setValueAtTime(1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.32);
  }

  private hat(t: number, out: AudioNode, dur: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.6, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(hp).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.01);
  }

  private clap(t: number, out: AudioNode) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1500;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    src.connect(bp).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.2);
  }

  private bass(t: number, freq: number, out: AudioNode) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(180, t + STEP_SEC * 1.8);
    f.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.7, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + STEP_SEC * 1.9);
    o.connect(f).connect(g).connect(out);
    o.start(t);
    o.stop(t + STEP_SEC * 2);
  }

  private pad(t: number, freq: number, dur: number, out: AudioNode) {
    const ctx = this.ctx!;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 1100;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.35, t + dur * 0.3);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    f.connect(g).connect(out);
    for (const detune of [-8, 8]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = freq;
      o.detune.value = detune;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  private tone(
    t: number,
    freq: number,
    dur: number,
    type: OscillatorType,
    out: AudioNode,
    vol: number,
    cutoff = 0,
    echo = false,
  ) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    let node: AudioNode = o;
    if (cutoff) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = cutoff;
      node = node.connect(f);
    }
    node.connect(g).connect(out);
    if (echo) g.connect(this.delay);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // ---------- Sound effects ----------

  private sfxTone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, delay = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private sfxNoise(dur: number, vol: number, from: number, to: number, type: BiquadFilterType = "bandpass") {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = 2;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t, Math.random() * 0.3);
    src.stop(t + dur + 0.02);
  }

  orb(combo: number) {
    const base = 69 + 12 + [0, 3, 7, 10, 12, 15, 19, 22, 24][Math.min(combo, 8)];
    this.sfxTone(mtof(base), 0.18, "sine", 0.5);
    this.sfxTone(mtof(base + 7), 0.22, "triangle", 0.25, undefined, 0.05);
  }

  graze(combo: number) {
    this.sfxNoise(0.25, 0.5, 800, 5000);
    this.sfxTone(mtof(84 + Math.min(combo, 12)), 0.12, "square", 0.08);
  }

  quota() {
    this.sfxTone(mtof(88), 0.3, "sine", 0.3);
    this.sfxTone(mtof(93), 0.4, "sine", 0.25, undefined, 0.08);
  }

  forget() {
    // Tape-rewind sweep.
    this.sfxTone(90, 0.6, "sawtooth", 0.25, 1400);
    this.sfxNoise(0.6, 0.35, 300, 6000);
  }

  loop() {
    this.sfxTone(mtof(81), 0.5, "sine", 0.2);
    this.sfxTone(mtof(88), 0.6, "sine", 0.15, undefined, 0.04);
  }

  comboLost() {
    this.sfxTone(mtof(64), 0.2, "triangle", 0.15, mtof(57));
  }

  death() {
    this.sfxNoise(0.9, 0.9, 4000, 60, "lowpass");
    this.sfxTone(420, 1.0, "sawtooth", 0.4, 30);
    this.sfxTone(220, 0.08, "square", 0.3);
  }

  fade() {
    this.sfxTone(mtof(76), 1.2, "sine", 0.35, mtof(40));
  }

  click() {
    this.sfxTone(1800, 0.04, "square", 0.08);
  }
}
