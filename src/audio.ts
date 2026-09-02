/**
 * SoundManager — centralized audio for marble stages with custom Music & SFX sliders.
 *
 * Bgm is streamed via HTMLAudioElement (mp3 files under www/audio/).
 * Sfx are decoded into AudioBuffers and played through WebAudio for
 * low-latency, overlapping playback. A looping roll sound is managed
 * via a persistent AudioBufferSourceNode whose gain tracks marble speed and SFX volume.
 */

export type SfxName =
  | 'roll'
  | 'bounce'
  | 'fall'
  | 'shatter'
  | 'muncher'
  | 'checkpoint'
  | 'goal'
  | 'springboard'
  | 'item';

const BGM_TABLE: Record<string, string> = {
  intro: 'marble-056.mp3', // Title / attract theme
  '1': 'marble-073.mp3',   // Practice Race (Stage 1)
  '2': 'marble-075.mp3',   // Beginner Race / Arctic (Stage 2)
  '3': 'marble-069.mp3',   // Intermediate / Astral Spire (Stage 3)
  '4': 'marble-066.mp3',   // Aerial / Pyramid Oasis (Stage 4)
  '5': 'marble-077.mp3',   // Edgy Maze (Stage 5)
  '6': 'marble-079.mp3',   // Dusty Trail (Stage 6)
  '7': 'marble-081.mp3',   // Drillin' Rye (Stage 7)
  '8': 'marble-067.mp3',   // Space Dementia / Ultimate Race (Stage 8)
};

const SFX_TABLE: Record<SfxName, string> = {
  roll: 'marble-049.mp3',
  bounce: 'marble-050.mp3',
  fall: 'marble-051.mp3',
  shatter: 'marble-052.mp3',
  muncher: 'marble-053.mp3',
  checkpoint: 'marble-054.mp3',
  springboard: 'marble-060.mp3',
  goal: 'marble-061.mp3',
  item: 'marble-065.mp3',
};

const AUDIO_ROOT = 'www/audio/';

export class SoundManager {
  audioCtx: AudioContext | null = null;
  sounds: Map<string, HTMLAudioElement | AudioBuffer> = new Map();
  currentBgm: HTMLAudioElement | null = null;
  currentBgmKey: string = '';
  isMuted: boolean = false;

  // Dedicated Music and SFX volume sliders (default pleasant non-deafening mix)
  public musicVolume = 0.35;
  public sfxVolume = 0.55;

  // Rolling-marble loop plumbing
  private rollSource: AudioBufferSourceNode | null = null;
  private rollGain: GainNode | null = null;
  private rollPlaying = false;

  constructor() {
    this.loadSettings();
  }

  private loadSettings(): void {
    const savedMusic = localStorage.getItem('marble_music_volume') || localStorage.getItem('mm_music_volume');
    if (savedMusic !== null) this.musicVolume = Math.max(0, Math.min(1, parseFloat(savedMusic)));

    const savedSfx = localStorage.getItem('marble_sfx_volume') || localStorage.getItem('mm_sfx_volume');
    if (savedSfx !== null) this.sfxVolume = Math.max(0, Math.min(1, parseFloat(savedSfx)));

    const savedMute = localStorage.getItem('mm_is_muted');
    if (savedMute !== null) this.isMuted = savedMute === 'true';
  }

  public getMusicVolume(): number {
    return this.musicVolume;
  }

  public setMusicVolume(vol: number): void {
    this.musicVolume = Math.max(0, Math.min(1, vol));
    localStorage.setItem('marble_music_volume', String(this.musicVolume));
    localStorage.setItem('mm_music_volume', String(this.musicVolume));
    if (this.currentBgm) {
      this.currentBgm.volume = this.isMuted ? 0 : this.musicVolume;
    }
  }

  public getSfxVolume(): number {
    return this.sfxVolume;
  }

  public setSfxVolume(vol: number): void {
    this.sfxVolume = Math.max(0, Math.min(1, vol));
    localStorage.setItem('marble_sfx_volume', String(this.sfxVolume));
    localStorage.setItem('mm_sfx_volume', String(this.sfxVolume));
  }

  /** Initialize AudioContext; must be called from a user-gesture handler. */
  init(): void {
    if (this.audioCtx) {
      if (this.audioCtx.state === 'suspended') {
        void this.audioCtx.resume();
      }
      return;
    }

    try {
      const Ctor: typeof AudioContext =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.audioCtx = new Ctor();
      void this.audioCtx.resume();
    } catch (err) {
      console.warn('[SoundManager] AudioContext unavailable:', err);
      this.audioCtx = null;
      return;
    }

    // Pre-decode looping / short sfx sources
    for (const [name, file] of Object.entries(SFX_TABLE)) {
      void this.loadBuffer(name, `${AUDIO_ROOT}${file}`);
    }
  }

  private async loadBuffer(key: string, path: string): Promise<void> {
    if (!this.audioCtx) return;
    if (this.sounds.has(key)) return;
    try {
      const res = await fetch(path);
      if (!res.ok) {
        console.warn(`[SoundManager] missing sound: ${path}`);
        return;
      }
      const arrayBuf = await res.arrayBuffer();
      const buffer = await this.audioCtx.decodeAudioData(arrayBuf);
      this.sounds.set(key, buffer);
    } catch (err) {
      console.warn(`[SoundManager] failed to load ${path}:`, err);
    }
  }

  /** Play (looping) background music for a key or stage number. */
  playBgm(stageId: number | 'intro'): void {
    const key = String(stageId);
    const file = BGM_TABLE[key];
    if (!file) return;

    if (
      this.currentBgm &&
      this.currentBgmKey === key &&
      !this.currentBgm.paused
    ) {
      return;
    }

    this.stopBgm();
    this.currentBgmKey = key;

    const mapKey = `bgm:${file}`;
    let el = this.sounds.get(mapKey) as HTMLAudioElement | undefined;

    if (!el) {
      el = new Audio(AUDIO_ROOT + file);
      el.loop = true;
      el.preload = 'auto';
      this.sounds.set(mapKey, el);
    }

    el.volume = this.isMuted ? 0 : this.musicVolume;
    el.currentTime = 0;
    void el.play().catch((err) => {
      console.warn('[SoundManager] bgm play blocked:', err);
      if (this.audioCtx?.state === 'suspended') {
        void this.audioCtx.resume().then(() => el!.play().catch(() => {}));
      }
    });

    this.currentBgm = el;
  }

  /** Stop and dispose of the current background music playback. */
  stopBgm(): void {
    if (this.currentBgm) {
      this.currentBgm.pause();
      this.currentBgm.currentTime = 0;
      this.currentBgm = null;
    }
    this.currentBgmKey = '';
  }

  /**
   * Play a one-shot sound effect. `volume` (0..1) scales the default mix.
   */
  playSfx(name: SfxName, volume = 1.0): void {
    if (this.isMuted) return;
    if (name === 'roll') return;
    this.playBuffer(name, volume * this.sfxVolume);
  }

  private playBuffer(key: string, volume: number): void {
    const ctx = this.audioCtx;
    if (!ctx || ctx.state !== 'running') return;

    const buf = this.sounds.get(key);
    if (!buf || !(buf instanceof AudioBuffer)) {
      this.synthesizeSfxFallback(key, volume);
      return;
    }

    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    src.buffer = buf;
    gain.gain.value = Math.max(0, Math.min(1, volume));
    src.connect(gain).connect(ctx.destination);
    src.onended = () => {
      src.disconnect();
      gain.disconnect();
    };
    src.start(0);
  }

  private synthesizeSfxFallback(name: string, volume: number): void {
    const ctx = this.audioCtx;
    if (!ctx || ctx.state !== 'running') return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(1, volume * 0.4));

    if (name === 'bounce') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.12);
    } else if (name === 'shatter') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(650, now);
      osc.frequency.exponentialRampToValueAtTime(90, now + 0.35);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.35);
    } else if (name === 'item' || name === 'checkpoint') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(1040, now + 0.18);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.18);
    } else if (name === 'goal') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(554.37, now + 0.12);
      osc.frequency.setValueAtTime(659.25, now + 0.24);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.5);
    }
  }

  /**
   * Drive the looping roll sound from marble speed.
   */
  setRollVolume(speedRatio: number): void {
    const ctx = this.audioCtx;
    if (!ctx) return;

    const clamped = Math.max(0, Math.min(1, speedRatio));
    const wanted = !this.isMuted && clamped > 0.02 && this.sfxVolume > 0.01;

    if (!this.rollPlaying && wanted) {
      this.startRollLoop();
      return;
    }

    if (!this.rollPlaying) {
      if (!wanted) this.stopRollLoop();
      return;
    }

    if (!wanted) {
      this.stopRollLoop();
      return;
    }

    const targetGain = (0.12 + clamped * 0.48) * this.sfxVolume;
    if (this.rollGain) {
      const now = ctx.currentTime;
      this.rollGain.gain.cancelScheduledValues(now);
      this.rollGain.gain.setTargetAtTime(targetGain, now, 0.05);
    }

    if (this.rollSource) {
      try {
        this.rollSource.playbackRate.setTargetAtTime(
          0.75 + clamped * 0.75,
          ctx.currentTime,
          0.1,
        );
      } catch {
        /* ignore */
      }
    }
  }

  private startRollLoop(): void {
    const ctx = this.audioCtx;
    if (!ctx) return;

    const buf = this.sounds.get('roll');
    if (!buf || !(buf instanceof AudioBuffer)) {
      void this.loadBuffer('roll', `${AUDIO_ROOT}marble-049.mp3`);
      return;
    }

    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = 1;
    gain.gain.value = 0.2 * this.sfxVolume;
    src.connect(gain).connect(ctx.destination);
    src.start(0);

    this.rollSource = src;
    this.rollGain = gain;
    this.rollPlaying = true;
  }

  private stopRollLoop(): void {
    if (this.rollSource) {
      try {
        this.rollSource.stop();
      } catch {
        /* already stopped */
      }
      this.rollSource.disconnect();
      this.rollSource = null;
    }
    if (this.rollGain) {
      this.rollGain.disconnect();
      this.rollGain = null;
    }
    this.rollPlaying = false;
  }

  setMuted(muted: boolean): void {
    if (this.isMuted === muted) return;
    this.isMuted = muted;
    localStorage.setItem('mm_is_muted', String(muted));

    if (muted) {
      if (this.currentBgm) this.currentBgm.volume = 0;
      this.stopRollLoop();
    } else {
      if (this.currentBgm) {
        this.currentBgm.volume = this.musicVolume;
        if (this.currentBgm.paused) {
          void this.currentBgm.play().catch(() => {});
        }
      }
    }
  }

  toggleMute(): boolean {
    this.setMuted(!this.isMuted);
    return this.isMuted;
  }

  /** Release all audio resources (page teardown). */
  dispose(): void {
    this.stopBgm();
    this.stopRollLoop();
    for (const sound of this.sounds.values()) {
      if (sound instanceof HTMLAudioElement) {
        sound.pause();
        sound.src = '';
      }
    }
    this.sounds.clear();
  }
}

export const soundManager = new SoundManager();
