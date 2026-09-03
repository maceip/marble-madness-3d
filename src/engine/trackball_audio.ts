/**
 * Procedural sound for the simulated arcade trackball (see docs/TRACKBALL_AUDIO.md).
 *
 * Reference implementation, NOT wired in. Drives four layers from the trackball state:
 *   1. bearing whine   — continuous, pitch and level follow angular speed ω, panned with the roll direction
 *   2. chassis rumble  — sub-bass that follows |α| (change of speed), not speed itself
 *   3. skin catch/slap — one-shot when a finger lands on a spinning ball, scaled by the energy killed
 *   4. encoder ticks   — optional very quiet clicks every 6°, matching the haptic teeth
 * plus a soft breakaway "tock" and a brake "scrub".
 *
 * Wiring (owner of trackball.ts / audio.ts):
 *   const tba = new TrackballAudio(ctx, sfxBusGainNode);
 *   Trackball.startDrag()  -> tba.onGrab(speed)          Trackball.dragDelta counter-brake -> tba.onBrake(speed)
 *   Trackball breakout     -> tba.onBreakout()           Trackball.endDrag() -> tba.onRelease()
 *   every frame            -> tba.update(wx, wy, dt)     (after Trackball.update)
 *   SFX volume / toggle    -> tba.setEnabled(bool), and the bus gain you pass in
 * The AudioContext must already be running (resume on first user gesture, as Sound.init does).
 */

export interface TrackballAudioTuning {
  maxOmega: number;        // rad/s at which the whine reaches full pitch/level (trackball.maxOmega)
  whineGain: number;       // peak level of the whine layer
  whineF1: number;         // resonator centres at pitch ratio 1.0
  whineF2: number;
  whineQ: number;
  pitchMin: number;        // pitch ratio at ω→0
  pitchMax: number;        // pitch ratio at ω = maxOmega
  growlGain: number;       // low body under the whine
  rumbleGain: number;      // chassis layer peak
  alphaMax: number;        // rad/s² that saturates the rumble
  rumbleAttack: number;    // seconds (time constants for setTargetAtTime)
  rumbleRelease: number;
  slapGain: number;
  slapOmegaRef: number;    // ω that gives a full-strength slap
  tickGain: number;        // 0 disables the audible encoder ticks
  tickStepRad: number;     // 6° like the haptics
  tickMaxHz: number;
}

export const DEFAULT_TUNING: TrackballAudioTuning = {
  maxOmega: 32,
  whineGain: 0.35, whineF1: 420, whineF2: 1280, whineQ: 14, pitchMin: 0.6, pitchMax: 2.2,
  growlGain: 0.18,
  rumbleGain: 0.45, alphaMax: 40, rumbleAttack: 0.005, rumbleRelease: 0.12,
  slapGain: 0.6, slapOmegaRef: 15,
  tickGain: 0.0, tickStepRad: Math.PI / 30, tickMaxHz: 35,
};

/** 2 s of pink noise (Paul Kellet's filter on white noise), normalised to ~-12 dBFS peak */
function pinkNoiseBuffer(ctx: AudioContext, seconds = 2): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, peak = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.96900 * b2 + w * 0.1538520;
    b3 = 0.86650 * b3 + w * 0.3104856; b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
    const p = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
    d[i] = p; if (Math.abs(p) > peak) peak = Math.abs(p);
  }
  const k = 0.25 / (peak || 1);
  for (let i = 0; i < n; i++) d[i] *= k;
  return buf;
}

/** 12 ms of white noise for the slap / tick transients */
function whiteBurstBuffer(ctx: AudioContext, seconds = 0.05): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * 0.8;
  return buf;
}

export class TrackballAudio {
  readonly out: GainNode;
  private enabled = true;
  private readonly t: TrackballAudioTuning;
  private readonly noise: AudioBufferSourceNode;
  private readonly burst: AudioBuffer;
  // layer 1: whine (two resonators) + growl
  private readonly res1: BiquadFilterNode; private readonly res2: BiquadFilterNode; private readonly growl: BiquadFilterNode;
  private readonly whineGain: GainNode; private readonly pan: StereoPannerNode;
  // layer 2: rumble
  private readonly rumbleLP1: BiquadFilterNode; private readonly rumbleLP2: BiquadFilterNode; private readonly rumbleGain: GainNode;
  // state
  private lastSpeed = 0;
  private alphaEnv = 0;
  private tickAccum = 0;
  private lastTickAt = 0;

  constructor(private readonly ctx: AudioContext, destination: AudioNode, tuning: Partial<TrackballAudioTuning> = {}) {
    this.t = { ...DEFAULT_TUNING, ...tuning };
    this.out = ctx.createGain(); this.out.gain.value = 1; this.out.connect(destination);
    this.burst = whiteBurstBuffer(ctx);

    // one looping pink-noise source feeds every continuous layer; it runs forever at zero gain when idle (cheap)
    this.noise = ctx.createBufferSource();
    this.noise.buffer = pinkNoiseBuffer(ctx); this.noise.loop = true;
    this.noise.start(0, Math.random() * 1.5);

    // ---- bearing whine: pink noise → two high-Q bandpass resonators (steel race harmonics) → gain → pan
    this.res1 = ctx.createBiquadFilter(); this.res1.type = 'bandpass'; this.res1.frequency.value = this.t.whineF1; this.res1.Q.value = this.t.whineQ;
    this.res2 = ctx.createBiquadFilter(); this.res2.type = 'bandpass'; this.res2.frequency.value = this.t.whineF2; this.res2.Q.value = this.t.whineQ;
    this.growl = ctx.createBiquadFilter(); this.growl.type = 'bandpass'; this.growl.frequency.value = 180; this.growl.Q.value = 1.2;
    const growlGain = ctx.createGain(); growlGain.gain.value = this.t.growlGain;
    this.whineGain = ctx.createGain(); this.whineGain.gain.value = 0;
    this.pan = ctx.createStereoPanner();
    this.noise.connect(this.res1).connect(this.whineGain);
    this.noise.connect(this.res2).connect(this.whineGain);
    this.noise.connect(this.growl).connect(growlGain).connect(this.whineGain);
    this.whineGain.connect(this.pan).connect(this.out);

    // ---- chassis rumble: pink noise → 2× lowpass 180 Hz (steep) → gain follows |α|
    this.rumbleLP1 = ctx.createBiquadFilter(); this.rumbleLP1.type = 'lowpass'; this.rumbleLP1.frequency.value = 180; this.rumbleLP1.Q.value = 0.9;
    this.rumbleLP2 = ctx.createBiquadFilter(); this.rumbleLP2.type = 'lowpass'; this.rumbleLP2.frequency.value = 180; this.rumbleLP2.Q.value = 0.9;
    this.rumbleGain = ctx.createGain(); this.rumbleGain.gain.value = 0;
    this.noise.connect(this.rumbleLP1).connect(this.rumbleLP2).connect(this.rumbleGain).connect(this.out);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) { this.whineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02); this.rumbleGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02); }
  }

  /**
   * Call once per frame after the physics step. wx/wy in rad/s (screen-down and screen-right), dt in seconds.
   * Pitch and level of the whine follow speed; the rumble follows how fast the speed is changing.
   */
  update(wx: number, wy: number, dt: number): void {
    if (!this.enabled || dt <= 0) return;
    const now = this.ctx.currentTime;
    const speed = Math.hypot(wx, wy);
    const s = Math.min(1, speed / this.t.maxOmega);

    // layer 1: whine
    const ratio = this.t.pitchMin + (this.t.pitchMax - this.t.pitchMin) * s;
    this.res1.frequency.setTargetAtTime(this.t.whineF1 * ratio, now, 0.03);
    this.res2.frequency.setTargetAtTime(this.t.whineF2 * ratio, now, 0.03);
    this.growl.frequency.setTargetAtTime(120 + 180 * s, now, 0.03);
    const level = speed < 0.3 ? 0 : this.t.whineGain * Math.pow(s, 1.2);
    this.whineGain.gain.setTargetAtTime(level, now, 0.03);
    // pan with the horizontal component of the roll: rolling right → sound drifts right
    this.pan.pan.setTargetAtTime(speed > 0.3 ? Math.max(-0.6, Math.min(0.6, (wy / speed) * 0.6)) : 0, now, 0.05);

    // layer 2: rumble from |α| with a fast-attack / slow-release envelope follower
    const alpha = Math.abs(speed - this.lastSpeed) / dt;
    this.lastSpeed = speed;
    const target = Math.min(1, alpha / this.t.alphaMax);
    const tc = target > this.alphaEnv ? this.t.rumbleAttack : this.t.rumbleRelease;
    this.alphaEnv += (target - this.alphaEnv) * Math.min(1, dt / tc);
    this.rumbleGain.gain.setTargetAtTime(this.t.rumbleGain * this.alphaEnv, now, 0.01);

    // layer 4 (optional): audible encoder teeth, same 6° spacing as the haptics, dropped above tickMaxHz
    if (this.t.tickGain > 0 && speed > 0.3) {
      this.tickAccum += speed * dt;
      if (this.tickAccum >= this.t.tickStepRad) {
        this.tickAccum %= this.t.tickStepRad;
        if (now - this.lastTickAt >= 1 / this.t.tickMaxHz) { this.lastTickAt = now; this.transient(3000, 1.5, 0.002, this.t.tickGain * (0.3 + 0.7 * s)); }
      }
    } else this.tickAccum = 0;
  }

  /** finger lands on the ball; omega = its speed at that moment (slap only if it was actually spinning) */
  onGrab(omega: number): void {
    if (!this.enabled || omega < 2) return;
    const k = Math.sqrt(Math.min(1, omega / this.t.slapOmegaRef));      // energy ∝ ω², perception ∝ √
    this.transient(2500, 0.8, 0.012, this.t.slapGain * k);               // skin on resin: 12 ms of high-passed noise
    this.clunk(90, 0.04, this.t.slapGain * 0.8 * k);                     // the ball's momentum into the chassis
  }

  /** static friction broke: a soft mechanical tock */
  onBreakout(): void { if (this.enabled) this.transient(200, 2.0, 0.008, 0.15); }

  /** spinning the ball against its motion: a short scrub plus a clunk */
  onBrake(omega: number): void {
    if (!this.enabled) return;
    const k = Math.min(1, omega / this.t.maxOmega);
    this.transient(3000, 0.7, 0.06, 0.25 + 0.35 * k);
    this.clunk(110, 0.03, 0.3 * k);
  }

  /** finger lifted: nothing to play; the whine keeps following ω as the physics decays */
  onRelease(): void { /* intentionally silent */ }

  // ---- one-shots -------------------------------------------------------------------------------------------
  private transient(centreHz: number, q: number, seconds: number, gain: number): void {
    const src = this.ctx.createBufferSource(); src.buffer = this.burst;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = centreHz; bp.Q.value = q;
    const g = this.ctx.createGain();
    const now = this.ctx.currentTime;
    g.gain.setValueAtTime(gain, now); g.gain.exponentialRampToValueAtTime(0.001, now + seconds);
    src.connect(bp).connect(g).connect(this.out);
    src.start(now); src.stop(now + seconds + 0.005);
  }

  private clunk(hz: number, seconds: number, gain: number): void {
    const osc = this.ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = hz;
    const g = this.ctx.createGain();
    const now = this.ctx.currentTime;
    g.gain.setValueAtTime(gain, now); g.gain.exponentialRampToValueAtTime(0.001, now + seconds);
    osc.frequency.setValueAtTime(hz * 1.4, now); osc.frequency.exponentialRampToValueAtTime(hz, now + seconds * 0.5); // pitch drops as it settles
    osc.connect(g).connect(this.out);
    osc.start(now); osc.stop(now + seconds + 0.005);
  }
}
