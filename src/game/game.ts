import { Assets, FRAMES, Frame } from '../engine/assets';
import { Renderer, Sprite, Label } from '../render/renderer';
import { Input } from '../engine/input';
import { Sound } from '../engine/audio';
import { Marble, MarbleEvent } from '../engine/physics';
import { StageDef, zonesAt, pipeAt, topAt, HeightMap, attachHeightMap, HmComponent, supportAt, highestBelow } from '../engine/level';
import { toWorld } from '../engine/iso';
import { STAGES } from '../levels';
import {
  VIEW_H, VIEW_W, PROGRESS_STEP, PROGRESS_POINTS, TIME_CAP, WAND_BONUS, TIMEZONE_PERIOD, TIMEZONE_BONUS,
  RESPAWN_DELAY, DEATH_PENALTY, FINISH_BONUS, SEC_LEFT_BONUS, TIME_BONUS_PER_SEC, BIRD_ZAP_RESETS_TO_START,
} from '../engine/constants';
import { fmtScore, fmtTime } from '../engine/font';
import { Hazard, makeHazard, HazardContext, HazardEvent } from './hazards';
import { Screens } from './screens';

export type Mode = '1p' | 'ai' | 'multi';
export type Screen = 'boot' | 'highrollers' | 'title' | 'menu' | 'name' | 'control' | 'connect' | 'intro' | 'race' | 'timebonus' | 'gameover' | 'congrats';

interface Popup { text: string; u: number; v: number; z: number; t: number; big?: boolean }

export interface HighRoller { name: string; score: number }

const DEFAULT_ROLLERS: HighRoller[] = [
  { name: 'ALEX', score: 152730 }, { name: 'SWEEP', score: 52500 }, { name: 'JULIE', score: 52250 },
  { name: 'TESS', score: 42000 }, { name: 'BARRY', score: 41750 }, { name: 'KEV', score: 31500 },
  { name: 'POPPI', score: 31250 }, { name: 'RACHEL', score: 21000 }, { name: 'PAUL', score: 20750 }, { name: 'ALI', score: 10500 },
];

export class Game {
  screen: Screen = 'boot';
  t = 0;                 // time on current screen
  mode: Mode = '1p';
  playerName = '';
  rollers: HighRoller[] = DEFAULT_ROLLERS;

  // race state
  stageIdx = 0;
  stage: StageDef = STAGES[0];
  stageImg: HTMLImageElement | null = null;
  marble = new Marble();
  hazards: Hazard[] = [];
  score = 0;
  displayScore = 0;
  timeLeft = 0;
  carried = 0;
  introPool = 0;          // seconds still to transfer during the intro
  deaths = 0;
  popups: Popup[] = [];
  progressMax = -Infinity;
  bonusTaken = new Set<string>();
  checkpointIdx = 0;
  respawnT = 0;
  timezoneT = 0;
  timezoneTag = 0;
  raceTime = 0;
  bonusCount = 0;
  bonusTotal = 0;
  fade = 0;
  goalReached = false;
  finalTally = { total: 0, drained: 0 };
  rng = mulberry32(1234);
  screens: Screens;
  /** remote / AI marbles (2P modes) */
  others: Marble[] = [];
  pendingRespawnAtStart = false;
  paused = false;
  /** lobby / networking (see net.ts) */
  lobbyId = '';
  publicOrigin = location.origin;
  agentJoined = false;
  scoreSubmitted = false;

  constructor(readonly assets: Assets, readonly r: Renderer, readonly input: Input, readonly sound: Sound) {
    this.screens = new Screens(this);
  }

  /** debug: what is under map pixel (mx,my) assuming height z */
  probe(mx: number, my: number, z: number): unknown {
    const w = toWorld(mx, my, z);
    const sup = supportAt(this.stage, w.u, w.v, z);
    const hb = highestBelow(this.stage, w.u, w.v, z);
    const hm = this.stage.heightmap;
    const lab = hm ? hm.labels[Math.round(my) * hm.width + Math.round(mx)] : -1;
    const cands = this.stage.surfaces.filter((s) => s.hm && hm && hm.hit(s.hm.comp, w.u, w.v, hm.zOf(s.hm.comp, w.u, w.v))).map((s) => `${s.name}@${hm!.zOf(s.hm!.comp, w.u, w.v).toFixed(1)}`);
    return { u: +w.u.toFixed(2), v: +w.v.toFixed(2), label: lab, sup: sup ? `${sup.s.name}@${sup.z.toFixed(1)}` : null, hb: hb ? `${hb.s.name}@${hb.z.toFixed(1)}` : null, cands };
  }

  /* ---------------------------------------------------------------------- */
  /* flow                                                                    */
  /* ---------------------------------------------------------------------- */

  go(screen: Screen): void {
    this.screen = screen; this.t = 0;
    this.screens.enter(screen);
  }

  async start(): Promise<void> {
    void this.fetchRollers();
    const q = new URLSearchParams(location.search);
    const stage = q.get('stage');
    if (stage) {
      this.playerName = 'TEST';
      this.newGame(Math.max(1, Math.min(STAGES.length, +stage)) - 1);
      return;
    }
    this.go('highrollers');
  }

  async submitScore(): Promise<void> {
    if (this.scoreSubmitted || this.score <= 0) return;
    this.scoreSubmitted = true;
    try {
      await fetch('/api/leaderboard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: this.playerName || 'ACE', score: this.score, intelligence: this.isAI ? 'AI' : 'NI', stage: this.stageIdx + 1, timeRemaining: Math.floor(this.timeLeft), deaths: this.deaths }),
      });
      await this.fetchRollers();
    } catch { /* offline */ }
  }
  isAI = false;

  async fetchRollers(): Promise<void> {
    try {
      const res = await fetch('/api/leaderboard');
      if (!res.ok) return;
      const j = await res.json() as { top50?: { name: string; score: number }[] };
      if (j.top50 && j.top50.length) this.rollers = j.top50.slice(0, 10).map((e) => ({ name: e.name.toUpperCase(), score: e.score }));
    } catch { /* offline */ }
  }

  newGame(stageIdx = 0): void {
    this.score = 0; this.displayScore = 0; this.deaths = 0; this.carried = 0; this.scoreSubmitted = false;
    void this.loadStage(stageIdx).then(() => this.go('intro'));
  }

  async loadStage(idx: number): Promise<void> {
    this.stageIdx = idx;
    this.stage = STAGES[idx];
    this.stageImg = await this.assets.stage(this.stage.image);
    if (!this.stage.heightmap) {
      const hm = await loadHeightMap(this.stage);
      if (hm) attachHeightMap(this.stage, hm);
    }
    this.resetStageState();
  }

  resetStageState(): void {
    const s = this.stage;
    const top = topAt(s, s.start.u, s.start.v);
    this.marble.place(s.start.u, s.start.v, s.start.z ?? (top ? top.z : 0));
    this.marble.rollDist = 0;
    this.hazards = s.hazards.map(makeHazard);
    const ctx = this.hazardCtx(0);
    for (const h of this.hazards) h.reset(ctx);
    this.popups = [];
    this.progressMax = (this.marble.u + this.marble.v) * s.progressDir;
    this.bonusTaken.clear();
    this.checkpointIdx = 0;
    this.respawnT = 0;
    this.raceTime = 0;
    this.goalReached = false;
    this.timezoneT = 0; this.timezoneTag = 0;
    this.introPool = s.timeAdd;
    this.timeLeft = s.carryTime ? this.carried : 0;
    this.centerCameraOnMarble(true);
  }

  /* ---------------------------------------------------------------------- */
  /* update                                                                  */
  /* ---------------------------------------------------------------------- */

  update(dt: number): void {
    this.t += dt;
    switch (this.screen) {
      case 'intro': this.updateIntro(dt); break;
      case 'race': this.updateRace(dt); break;
      case 'timebonus': this.updateTimeBonus(dt); break;
      default: this.screens.update(dt); break;
    }
    // score display eases toward the real score
    if (this.displayScore !== this.score) {
      const diff = this.score - this.displayScore;
      const step = Math.max(10, Math.ceil(Math.abs(diff) * Math.min(1, dt * 6)));
      this.displayScore += Math.sign(diff) * Math.min(Math.abs(diff), step);
      this.displayScore = Math.round(this.displayScore / 10) * 10;
    }
  }

  private updateIntro(dt: number): void {
    if (this.t < 0.6) return;
    if (this.introPool > 0) {
      if (this.t > 0.6 && this.stage.music && !this.musicStarted) { this.musicStarted = true; this.sound.playBgm(this.stage.music); }
      const rate = 22 * dt;
      const take = Math.min(this.introPool, rate);
      this.introPool -= take;
      this.timeLeft = Math.min(TIME_CAP, this.timeLeft + take);
      this.introTick += take;
      if (this.introTick >= 5) { this.introTick -= 5; this.sound.sfx('tick', 0.35, 1.4); }
      if (this.introPool <= 0.001) { this.introPool = 0; this.introDone = this.t; }
    } else if (this.t - this.introDone > 0.7) {
      this.go('race');
      this.raceTime = 0;
    }
    this.centerCameraOnMarble(false, dt);
  }
  private musicStarted = false;
  private introTick = 0;
  private introDone = 0;

  private hazardCtx(dt: number): HazardContext {
    void dt;
    return {
      level: this.stage, assets: this.assets, marbles: [this.marble, ...this.others.filter((m) => m.phase === 'alive')], local: this.marble,
      time: this.raceTime, rng: this.rng, onEvent: (e) => this.onHazardEvent(e),
    };
  }

  private onHazardEvent(e: HazardEvent): void {
    switch (e.type) {
      case 'sfx': this.sound.sfx(e.name, e.vol ?? 1); break;
      case 'wand':
        this.timeLeft = Math.min(TIME_CAP, this.timeLeft + WAND_BONUS);
        this.popups.push({ text: `+${WAND_BONUS} SEC`, u: e.marble.u, v: e.marble.v, z: e.marble.z, t: 0 });
        this.sound.sfx('checkpoint');
        break;
      case 'bird-zap':
        e.marble.die('zap');
        this.sound.sfx('shatter');
        if (BIRD_ZAP_RESETS_TO_START && e.marble === this.marble) this.pendingRespawnAtStart = true;
        break;
      case 'steelie-bump': break;
    }
  }

  private updateRace(dt: number): void {
    if (this.paused) return;
    const s = this.stage;
    this.raceTime += dt;
    // timer
    if (this.marble.phase === 'alive' || this.marble.phase === 'dying') {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) { this.timeLeft = 0; this.gameOver(); return; }
    }

    // marble physics
    const steer = this.input.sample(dt);
    const ev: MarbleEvent[] = [];
    this.marble.step(s, steer, dt, ev);
    for (const e of ev) this.onMarbleEvent(e);

    // hazards
    const ctx = this.hazardCtx(dt);
    for (const h of this.hazards) h.update(dt, ctx);

    // zones, pipes, progress
    if (this.marble.phase === 'alive' && !this.marble.inPipe) this.checkZones();

    // death handling
    if (this.marble.phase === 'dead') {
      this.respawnT += dt;
      if (this.respawnT >= RESPAWN_DELAY) this.respawn();
    }

    // popups
    for (const p of this.popups) p.t += dt;
    this.popups = this.popups.filter((p) => p.t < 2.6);

    // roll sound
    const sp = this.marble.phase === 'alive' && this.marble.grounded && !this.marble.inPipe ? this.marble.speed / 15 : 0;
    this.sound.setRoll(sp);

    this.centerCameraOnMarble(false, dt);
  }

  private onMarbleEvent(e: MarbleEvent): void {
    switch (e.type) {
      case 'bounce': this.sound.sfx('bounce', Math.min(1, 0.3 + (e.speed ?? 0) * 0.06)); break;
      case 'land': if ((e.fall ?? 0) > 6) this.sound.sfx('bounce', 0.5, 0.8); break;
      case 'dizzy': this.sound.sfx('fall', 0.7); break;
      case 'die':
        this.deaths++;
        if (e.kind === 'shatter' || e.kind === 'void' || e.kind === 'zap') this.sound.sfx('shatter');
        else if (e.kind === 'squeeze') this.sound.sfx('muncher');
        this.respawnT = 0;
        break;
      case 'airborne': break;
    }
  }

  private checkZones(): void {
    const m = this.marble; const s = this.stage;
    // progress points
    const prog = (m.u + m.v) * s.progressDir;
    while (prog >= this.progressMax + PROGRESS_STEP) { this.progressMax += PROGRESS_STEP; this.score += PROGRESS_POINTS; }
    // pipes
    const pipe = pipeAt(s, m.u, m.v, m.z);
    if (pipe && m.grounded) {
      m.inPipe = true; m.pipeT = pipe.duration; m.pipeExit = pipe.exit;
      this.sound.sfx('springboard', 0.7);
      if (pipe.bonus) {
        const key = `pipe:${pipe.exit.u},${pipe.exit.v}`;
        if (!this.bonusTaken.has(key)) { this.bonusTaken.add(key); this.pendingPipeBonus = pipe.bonus; }
      }
      return;
    }
    if (this.pendingPipeBonus && !m.inPipe) {
      this.award(this.pendingPipeBonus, m); this.pendingPipeBonus = 0;
    }
    let inTimezone = false;
    for (const z of zonesAt(s, m.u, m.v, m.z)) {
      switch (z.kind) {
        case 'bonus': {
          const key = z.id ?? `b${z.u0},${z.v0}`;
          if (!this.bonusTaken.has(key)) { this.bonusTaken.add(key); this.award(z.value ?? 1000, m); }
          break;
        }
        case 'checkpoint': {
          const idx = z.value ?? 0;
          if (idx > this.checkpointIdx) { this.checkpointIdx = idx; }
          break;
        }
        case 'goal':
          if (!this.goalReached) { this.goalReached = true; this.reachGoal(); }
          break;
        case 'timezone': inTimezone = true; break;
        case 'kill': m.die('void'); break;
      }
    }
    if (inTimezone && m.grounded) {
      this.timezoneT += 1 / 60;
      this.timezoneTag = 1;
      if (this.timezoneT >= TIMEZONE_PERIOD) {
        this.timezoneT = 0;
        this.timeLeft = Math.min(TIME_CAP, this.timeLeft + TIMEZONE_BONUS);
        this.sound.sfx('checkpoint', 0.6, 1.2);
      }
    } else { this.timezoneTag = 0; this.timezoneT = 0; }
  }
  private pendingPipeBonus = 0;

  award(points: number, at: { u: number; v: number; z: number }): void {
    this.score += points;
    this.popups.push({ text: String(points), u: at.u, v: at.v, z: at.z, t: 0 });
    this.sound.sfx('item');
  }

  private reachGoal(): void {
    this.sound.stopBgm();
    this.sound.stopRoll();
    this.sound.sfx('goal');
    this.marble.vu *= 0.3; this.marble.vv *= 0.3;
    this.bonusTotal = Math.floor(this.timeLeft) * TIME_BONUS_PER_SEC;
    this.bonusCount = 0;
    this.go('timebonus');
  }

  private updateTimeBonus(dt: number): void {
    // marble keeps rolling to a stop
    const ev: MarbleEvent[] = [];
    this.marble.step(this.stage, { ax: 0, ay: 0 }, dt, ev);
    this.centerCameraOnMarble(false, dt);
    if (this.t > 1.0 && this.bonusCount < this.bonusTotal) {
      const step = Math.min(this.bonusTotal - this.bonusCount, Math.ceil(this.bonusTotal * dt / 1.4 / 100) * 100);
      this.bonusCount += step; this.score += step;
      this.tickAcc += dt; if (this.tickAcc > 0.08) { this.tickAcc = 0; this.sound.sfx('tick', 0.3, 1.2); }
    }
    if (this.bonusCount >= this.bonusTotal && this.t > 2.6) {
      this.fade = Math.min(1, this.fade + dt * 2);
      if (this.fade >= 1 && this.t > 3.4) {
        this.carried = Math.floor(this.timeLeft);
        this.fade = 0;
        if (this.stageIdx + 1 < STAGES.length) {
          this.musicStarted = false;
          void this.loadStage(this.stageIdx + 1).then(() => this.go('intro'));
        } else {
          this.finishGame();
        }
      }
    }
  }
  private tickAcc = 0;

  private finishGame(): void {
    const secLeft = Math.floor(this.timeLeft);
    const total = FINISH_BONUS + secLeft * SEC_LEFT_BONUS - this.deaths * DEATH_PENALTY;
    this.finalTally = { total, drained: 0 };
    this.sound.playBgm('ending', false);
    this.go('congrats');
  }

  gameOver(): void {
    this.sound.stopBgm(); this.sound.stopRoll();
    this.go('gameover');
  }

  respawn(): void {
    const s = this.stage;
    let cp = s.checkpoints[Math.min(this.checkpointIdx, s.checkpoints.length - 1)] ?? s.start;
    if (this.pendingRespawnAtStart) { cp = s.start; this.checkpointIdx = 0; this.pendingRespawnAtStart = false; }
    const top = topAt(s, cp.u, cp.v);
    this.marble.place(cp.u, cp.v, top ? top.z : 0);
    this.progressMax = Math.max(this.progressMax, -Infinity);
    this.respawnT = 0;
  }

  /** stage-start camera (top of course) or follow */
  centerCameraOnMarble(snap: boolean, dt = 0): void {
    if (!this.stageImg) return;
    const m = this.marble;
    const my = (m.u + m.v) * 4 - m.z;
    const targetY = clamp(my - 112, 0, Math.max(0, this.stage.height - VIEW_H));
    const targetX = clamp(this.stage.viewX0, 0, Math.max(0, this.stage.width - VIEW_W));
    if (snap) { this.r.cam.y = targetY; this.r.cam.x = targetX; return; }
    const k = Math.min(1, dt * 5);
    this.r.cam.y += (targetY - this.r.cam.y) * k;
    this.r.cam.x = targetX;
  }

  /* ---------------------------------------------------------------------- */
  /* render                                                                  */
  /* ---------------------------------------------------------------------- */

  render(): void {
    const r = this.r;
    switch (this.screen) {
      case 'intro': case 'race': case 'timebonus':
        this.renderRace();
        break;
      default:
        this.screens.render();
    }
    r.present();
  }

  private renderRace(): void {
    const r = this.r;
    if (!this.stageImg) { r.clear(); return; }
    r.drawStage(this.stageImg, this.stage);
    const sprites: Sprite[] = [];
    const ctx = this.hazardCtx(0);
    for (const h of this.hazards) h.sprites(ctx, sprites);
    this.marbleSprites(this.marble, this.assets.sheets.marble, sprites);
    for (const o of this.others) this.marbleSprites(o, this.assets.sheets.marbleRed, sprites);
    r.drawSprites(sprites);

    const labels: Label[] = [];
    for (const p of this.popups) labels.push({ text: p.text, u: p.u, v: p.v, z: p.z, dy: -20 - Math.min(6, p.t * 6) });
    if (this.timezoneTag && this.marble.phase === 'alive') {
      labels.push({ text: `+${TIMEZONE_BONUS}`, u: this.marble.u, v: this.marble.v, z: this.marble.z, dy: -30 });
      labels.push({ text: 'SEC', u: this.marble.u, v: this.marble.v, z: this.marble.z, dy: -22 });
    }
    r.drawLabels(labels);

    // HUD
    r.drawHud(fmtScore(this.displayScore), fmtTime(this.timeLeft));

    if (this.screen === 'intro') {
      const title = this.stage.name;
      const bw = 232, bh = 30; const bx = (VIEW_W - bw) / 2, by = 36;
      r.drawBox(bx, by, bw, bh);
      r.text('TIME TO FINISH', bx + 36, by + 6, 'orange');
      r.text(title + ':', bx + 44, by + 16, 'cyan');
      const n = fmtTime(this.introPool);
      r.ctx.fillStyle = '#7d7d7d'; r.ctx.fillRect(bx + bw - 34, by + 6, 28, 18);
      r.font.drawBig(r.ctx, n, bx + bw - 32, by + 8);
    }
    if (this.screen === 'timebonus') {
      const bw = 96, bh = 46; const bx = 20, by = 40;
      r.drawBox(bx, by, bw, bh);
      r.textC('TIME', bx + bw / 2, by + 6, 'lavender');
      r.textC('BONUS', bx + bw / 2, by + 18, 'lavender');
      r.textC(fmtScore(this.bonusCount), bx + bw / 2, by + 32, 'lavender');
      if (this.fade > 0) { r.ctx.fillStyle = `rgba(0,0,0,${this.fade})`; r.ctx.fillRect(0, 0, VIEW_W, VIEW_H); }
    }
  }

  /** choose marble frame(s) from its state */
  marbleSprites(m: Marble, img: HTMLImageElement, out: Sprite[]): void {
    const F = FRAMES.marble;
    if (m.phase === 'hidden' || m.inPipe) return;
    const base = { img, u: m.u, v: m.v, z: m.z, dy: -8 };
    const groundZ = m.support ? m.support.z : m.z;
    if (m.phase === 'alive') {
      let f: Frame;
      if (m.dizzyT > 0) f = F.dizzy[Math.floor(m.dizzyT * 12) % F.dizzy.length];
      else f = F.roll[Math.floor(m.rollDist * 1.6) % F.roll.length];
      out.push({ ...base, frame: f, shadowZ: m.grounded ? 0 : m.z - groundZ });
      return;
    }
    if (m.phase === 'dying') {
      const t = m.deathT;
      switch (m.deathKind) {
        case 'shatter': case 'zap': {
          if (t < 0.36) out.push({ ...base, frame: F.crack[Math.min(2, Math.floor(t / 0.12))] });
          else if (t < 0.7) out.push({ ...base, frame: F.shards[0] });
          else if (t < 1.3) out.push({ ...base, frame: F.pileSparkle[Math.floor(t * 8) % 2] });
          else if (t < 2.4) out.push({ ...base, frame: F.sweep[Math.min(5, Math.floor((t - 1.3) / 0.18))] });
          else out.push({ ...base, frame: F.pile[0], alpha: 0.6 });
          break;
        }
        case 'squeeze': {
          const idx = Math.min(F.squeeze.length - 1, Math.floor(t / 1.1 * F.squeeze.length));
          out.push({ ...base, frame: F.squeeze[idx], flip: m.squeezeDir < 0 });
          break;
        }
        case 'dissolve': out.push({ ...base, frame: F.dissolve[Math.min(3, Math.floor(t / 0.3))] }); break;
        case 'crush': if (t > 0.3) out.push({ ...base, frame: F.pile[0] }); break;
        case 'void': {
          // keeps falling out of view
          out.push({ ...base, z: m.z - t * 260, frame: F.roll[Math.floor(t * 20) % 6], alpha: Math.max(0, 1 - t) });
          break;
        }
      }
    }
  }
}

/* ------------------------------------------------------------------------ */

async function loadHeightMap(stage: StageDef): Promise<HeightMap | null> {
  const base = stage.image.replace(/\.png$/, '');
  try {
    const [compsRes, img] = await Promise.all([
      fetch(`/assets/${base}.comps.json`),
      new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = `/assets/${base}.labels.png`; }),
    ]);
    if (!compsRes.ok) return null;
    const comps = await compsRes.json() as { width: number; height: number; components: HmComponent[] };
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, img.height).data;
    const labels = new Uint8Array(img.width * img.height);
    for (let i = 0; i < labels.length; i++) labels[i] = data[i * 4];
    return new HeightMap(img.width, img.height, labels, comps.components);
  } catch (err) {
    console.warn('heightmap missing for', stage.image, err);
    return null;
  }
}

function clamp(x: number, a: number, b: number): number { return Math.max(a, Math.min(b, x)); }

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
