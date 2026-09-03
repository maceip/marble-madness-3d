/**
 * Audio: stage BGM via HTMLAudioElement, SFX via WebAudio buffers.
 * Menus are silent (as in the NES original); music starts with the race intro.
 */
export type SfxName = 'roll' | 'bounce' | 'fall' | 'shatter' | 'muncher' | 'checkpoint' | 'goal' | 'springboard' | 'item' | 'tick';

export const BGM: Record<string, string> = {
  practice: 'bgm/practice-race.mp3',
  beginner: 'bgm/beginner-race.mp3',
  intermediate: 'bgm/intermediate-race.mp3',
  aerial: 'bgm/aerial-race.mp3',
  silly: 'bgm/silly-race.mp3',
  ultimate: 'bgm/ultimate-race.mp3',
  ending: 'marble-056.mp3',
};

const SFX: Record<SfxName, string> = {
  roll: 'marble-049.mp3',
  bounce: 'marble-050.mp3',
  fall: 'marble-051.mp3',
  shatter: 'marble-052.mp3',
  muncher: 'marble-053.mp3',
  checkpoint: 'marble-054.mp3',
  springboard: 'marble-060.mp3',
  goal: 'marble-061.mp3',
  item: 'marble-065.mp3',
  tick: 'marble-062.mp3',
};

const ROOT = '/audio/';

export class Sound {
  ctx: AudioContext | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private bgmEl: HTMLAudioElement | null = null;
  private bgmKey = '';
  musicVolume = 0.35;
  sfxVolume = 0.6;
  muted = false;
  private rollSrc: AudioBufferSourceNode | null = null;
  private rollGain: GainNode | null = null;

  constructor() {
    const mv = localStorage.getItem('mm_music'); if (mv) this.musicVolume = +mv;
    const sv = localStorage.getItem('mm_sfx'); if (sv) this.sfxVolume = +sv;
    this.muted = localStorage.getItem('mm_muted') === '1';
  }

  /** must be called from a user gesture */
  init(): void {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    try {
      this.ctx = new AudioContext();
      void this.ctx.resume();
    } catch { this.ctx = null; return; }
    for (const [k, f] of Object.entries(SFX)) void this.loadBuffer(k, ROOT + f);
  }

  private async loadBuffer(key: string, url: string): Promise<void> {
    if (!this.ctx || this.buffers.has(key)) return;
    try {
      const r = await fetch(url); if (!r.ok) return;
      const buf = await this.ctx.decodeAudioData(await r.arrayBuffer());
      this.buffers.set(key, buf);
    } catch { /* ignore */ }
  }

  setMusicVolume(v: number): void { this.musicVolume = clamp01(v); localStorage.setItem('mm_music', String(v)); if (this.bgmEl) this.bgmEl.volume = this.muted ? 0 : this.musicVolume; }
  setSfxVolume(v: number): void { this.sfxVolume = clamp01(v); localStorage.setItem('mm_sfx', String(v)); }
  setMuted(m: boolean): void { this.muted = m; localStorage.setItem('mm_muted', m ? '1' : '0'); if (this.bgmEl) this.bgmEl.volume = m ? 0 : this.musicVolume; if (m) this.stopRoll(); }

  playBgm(key: string, loop = true): void {
    const file = BGM[key]; if (!file) return;
    if (this.bgmEl && this.bgmKey === key && !this.bgmEl.paused) return;
    this.stopBgm();
    const el = new Audio(ROOT + file);
    el.loop = loop; el.volume = this.muted ? 0 : this.musicVolume; el.preload = 'auto';
    void el.play().catch(() => {});
    this.bgmEl = el; this.bgmKey = key;
  }

  stopBgm(): void {
    if (this.bgmEl) { this.bgmEl.pause(); this.bgmEl.src = ''; this.bgmEl = null; }
    this.bgmKey = '';
  }

  sfx(name: SfxName, vol = 1, rate = 1): void {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return;
    const buf = this.buffers.get(name);
    if (!buf) { this.synth(name, vol); return; }
    const src = this.ctx.createBufferSource(); const g = this.ctx.createGain();
    src.buffer = buf; src.playbackRate.value = rate; g.gain.value = clamp01(vol * this.sfxVolume);
    src.connect(g).connect(this.ctx.destination); src.onended = () => { src.disconnect(); g.disconnect(); };
    src.start();
  }

  private synth(name: string, vol: number): void {
    const ctx = this.ctx!; const t = ctx.currentTime;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    g.gain.value = clamp01(vol * this.sfxVolume * 0.3);
    o.connect(g).connect(ctx.destination);
    if (name === 'bounce') { o.type = 'triangle'; o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.1); }
    else if (name === 'tick') { o.type = 'square'; o.frequency.setValueAtTime(880, t); }
    else { o.type = 'square'; o.frequency.setValueAtTime(440, t); }
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.start(t); o.stop(t + 0.12);
  }

  /** looping roll noise whose gain follows marble speed (0..1) */
  setRoll(level: number): void {
    const ctx = this.ctx; if (!ctx || ctx.state !== 'running') return;
    const want = !this.muted && level > 0.03;
    if (want && !this.rollSrc) {
      const buf = this.buffers.get('roll'); if (!buf) return;
      const src = ctx.createBufferSource(); const g = ctx.createGain();
      src.buffer = buf; src.loop = true; g.gain.value = 0;
      src.connect(g).connect(ctx.destination); src.start();
      this.rollSrc = src; this.rollGain = g;
    }
    if (!want) { this.stopRoll(); return; }
    if (this.rollGain && this.rollSrc) {
      this.rollGain.gain.setTargetAtTime((0.1 + level * 0.5) * this.sfxVolume, ctx.currentTime, 0.05);
      this.rollSrc.playbackRate.setTargetAtTime(0.7 + level * 0.8, ctx.currentTime, 0.1);
    }
  }

  stopRoll(): void {
    if (this.rollSrc) { try { this.rollSrc.stop(); } catch { /* */ } this.rollSrc.disconnect(); this.rollSrc = null; }
    if (this.rollGain) { this.rollGain.disconnect(); this.rollGain = null; }
  }
}

function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }
