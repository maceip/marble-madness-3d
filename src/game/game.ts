import { Assets, FRAMES, Frame } from '../engine/assets';
import { Renderer, Sprite, Label } from '../render/renderer';
import { Input } from '../engine/input';
import { Sound } from '../engine/audio';
import { Marble, MarbleEvent } from '../engine/physics';
import { StageDef, zonesAt, pipeAt, topAt, HeightMap, attachHeightMap, HmComponent, supportAt, highestBelow, inRect, heightOn } from '../engine/level';
import { toWorld } from '../engine/iso';
import { surfaceMapPolygon } from '../engine/level';
import { STAGES } from '../levels';
import {
  VIEW_H, VIEW_W, PROGRESS_STEP, PROGRESS_POINTS, TIME_CAP, WAND_BONUS, TIMEZONE_PERIOD, TIMEZONE_BONUS,
  RESPAWN_DELAY, DEATH_PENALTY, FINISH_BONUS, SEC_LEFT_BONUS, TIME_BONUS_PER_SEC, BIRD_ZAP_RESETS_TO_START,
} from '../engine/constants';
import { fmtScore, fmtTime } from '../engine/font';
import { Hazard, makeHazard, HazardContext, HazardEvent } from './hazards';
import { Screens } from './screens';
import { Net, RemotePlayer } from './net';
import { WebMCP } from './webmcp';
import { TWO_PLAYER_TELEPORT_PENALTY, TWO_PLAYER_TRAIL_MARGIN, ARCADE_TIME_ADD, WON_RACE_BONUS } from '../engine/constants';
import { AITrackerOverlay } from '../render/ai_tracker';

export type Mode = '1p' | 'ai' | 'multi';
export type Screen = 'boot' | 'highrollers' | 'title' | 'menu' | 'name' | 'control' | 'connect' | 'intro' | 'race' | 'timebonus' | 'gameover' | 'congrats';

interface Popup { text: string; u: number; v: number; z: number; t: number; big?: boolean }

export interface HighRoller {
  name: string;
  score: number;
  intelligence?: string;
  rank?: number;
}

const DEFAULT_ROLLERS: HighRoller[] = [
  { name: '@MACEIP', score: 152730, intelligence: 'Natural', rank: 1 },
  { name: 'Qwen 3.8', score: 148900, intelligence: 'Artificial', rank: 2 },
  { name: 'DeepMarble', score: 139500, intelligence: 'Artificial', rank: 3 },
  { name: 'RollingJoe', score: 126400, intelligence: 'Natural', rank: 4 },
  { name: 'PixelPilot', score: 118200, intelligence: 'Natural', rank: 5 },
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
  agentReady = false;
  /** true on the agent's page (opened via /<uuid>) */
  isAgentPage = false;
  scoreSubmitted = false;
  net = new Net();
  webmcp!: WebMCP;
  onAgentDetected?: () => void;
  /** remote marbles keyed by network id */
  remote = new Map<string, Marble>();
  remoteInfo = new Map<string, RemotePlayer>();
  aiTrackers = new Map<string, AITrackerOverlay>();
  teleportCooldown = 0;
  /** 2P (arcade rules, 2player_longplay.mov): race outcome bookkeeping */
  finished = false;
  oppFinished = false;
  wonLast = false;
  wonPool = 0;
  wonDone = 0;
  waitingT = 0;
  goalFlags: { u: number; v: number; z: number }[] = [];

  constructor(readonly assets: Assets, readonly r: Renderer, readonly input: Input, readonly sound: Sound) {
    this.screens = new Screens(this);
    const mm = (window as unknown as { __MM__?: { lobby: string; fromPath: boolean; publicOrigin: string } }).__MM__;
    if (mm) { this.lobbyId = mm.lobby; this.isAgentPage = mm.fromPath; this.publicOrigin = mm.publicOrigin || location.origin; }
    if (!this.lobbyId) this.lobbyId = crypto.randomUUID();
    this.net.onJoined = (p) => {
      if (this.mode === 'ai' && !this.isAgentPage && p.role === 'ai' && !this.agentJoined) {
        this.agentJoined = true;
        this.screens.setConnectStatus('Agent connected! Starting the race...');
        window.setTimeout(() => { if (this.screen === 'connect') { this.net.sendStart(1); this.newGame(0); } }, 1200);
      }
    };
    this.net.onStart = (stage) => { if (this.isAgentPage) { this.sound.init(); this.newGame(Math.max(0, stage - 1)); } };
    this.net.onBump = (iu, iv) => { this.marble.impU += iu; this.marble.impV += iv; this.sound.sfx('bounce', 0.6); };
    this.net.onLeaderboard = (top) => { if (top.length) this.rollers = top.slice(0, 10).map((e, i) => ({ name: e.name, score: e.score, intelligence: (e as any).intelligence || 'Natural', rank: (e as any).rank ?? (i + 1) })); };
    this.sound.onInit = (s) => { this.input.trackball.audio = s.trackballAudio; };
    this.webmcp = new WebMCP(this);
  }

  /** inspector overlay (F1 or ?debug=1): shows collision components, marble coordinates, click-to-teleport */
  debug = false;
  debugCanvas: HTMLCanvasElement | null = null;
  debugStageId = -1;
  toast = { text: '', t: 0 };

  toggleDebug(): void { this.debug = !this.debug; this.showToast(this.debug ? 'INSPECTOR ON  F2=COPY REPORT  CLICK=TELEPORT' : 'INSPECTOR OFF'); }

  showToast(text: string): void { this.toast = { text, t: 3 }; }

  /** all surfaces that could be under map pixel (mx,my) at their own heights, best (highest) first */
  pickAtPixel(mx: number, my: number): { u: number; v: number; z: number; name: string }[] {
    const out: { u: number; v: number; z: number; name: string }[] = [];
    for (const s of this.stage.surfaces) {
      if (s.kind === 'wall') continue;
      if (s.hm) {
        const hm = s.hm.map;
        const x = Math.round(mx), y = Math.round(my);
        if (x < 0 || y < 0 || x >= hm.width || y >= hm.height) continue;
        if (hm.labels[y * hm.width + x] !== s.hm.comp.id) continue;
        // solve (u,v): z = a + b x + c y directly in map space
        const c = s.hm.comp;
        const z = c.pieces ? c.pieces[0].a + c.pieces[0].b * x + c.pieces[0].c * y : c.a + c.b * x + c.c * y;
        const w = toWorld(mx, my, z);
        out.push({ u: w.u, v: w.v, z, name: s.name ?? `hm${c.id}` });
      } else {
        // planar manual surface: iterate z (a few Newton steps) then test the footprint
        let z = s.z0;
        for (let i = 0; i < 6; i++) { const w = toWorld(mx, my, z); z = heightOn(s, w.u, w.v); }
        const w = toWorld(mx, my, z);
        if (inRect(s, w.u, w.v)) out.push({ u: w.u, v: w.v, z, name: s.name ?? `#${s.id}` });
      }
    }
    out.sort((a, b) => b.z - a.z);
    return out;
  }

  /** debug click: teleport the marble onto whatever is drawn at that view pixel */
  debugClick(viewX: number, viewY: number): void {
    const mx = viewX + this.r.cam.x, my = viewY + this.r.cam.y;
    const picks = this.pickAtPixel(mx, my);
    if (!picks.length) { this.showToast(`NOTHING AT ${Math.round(mx)},${Math.round(my)}`); return; }
    const p = picks[0];
    this.marble.place(p.u, p.v, p.z);
    this.showToast(`TELEPORT ${Math.round(mx)},${Math.round(my)} Z${Math.round(p.z)} ${p.name.toUpperCase()}`);
  }

  /** F2: copy a one-line report of where the marble is */
  copyReport(): void {
    const m = this.marble;
    const mx = Math.round((m.u - m.v) * 8), my = Math.round((m.u + m.v) * 4 - m.z);
    const under = this.stage.surfaces.filter((s) => inRect(s, m.u, m.v)).map((s) => `${s.name ?? s.id}${s.kind === 'wall' ? '[wall]' : ''}@${heightOn(s, m.u, m.v).toFixed(0)}`).join(' ');
    const line = `stage${this.stageIdx + 1} px=${mx},${my} z=${m.z.toFixed(0)} u=${m.u.toFixed(1)} v=${m.v.toFixed(1)} support=${m.support ? m.support.s.name : 'none'} grounded=${m.grounded} under=[${under}] blocked=${m.lastBlock || '-'}`;
    console.log('[report]', line);
    void navigator.clipboard?.writeText(line).catch(() => {});
    this.showToast('REPORT COPIED: ' + line.slice(0, 40));
  }

  /** debug: what is under map pixel (mx,my) assuming height z */
  probe(mx: number, my: number, z: number): unknown {
    const w = toWorld(mx, my, z);
    const sup = supportAt(this.stage, w.u, w.v, z);
    const hb = highestBelow(this.stage, w.u, w.v, z);
    const hm = this.stage.heightmap;
    const lab = hm ? hm.labels[Math.round(my) * hm.width + Math.round(mx)] : -1;
    const cands = this.stage.surfaces.filter((s) => inRect(s, w.u, w.v)).map((s) => `${s.name}${s.kind === 'wall' ? '[wall]' : ''}@${heightOn(s, w.u, w.v).toFixed(1)}`);
    return { u: +w.u.toFixed(2), v: +w.v.toFixed(2), label: lab, sup: sup ? `${sup.s.name}@${sup.z.toFixed(1)}` : null, hb: hb ? `${hb.s.name}@${hb.z.toFixed(1)}` : null, cands };
  }

  /* ---------------------------------------------------------------------- */
  /* flow                                                                    */
  /* ---------------------------------------------------------------------- */

  go(screen: Screen): void {
    this.screen = screen; this.t = 0;
    if (screen === 'connect' && !this.isAgentPage) {
      this.agentJoined = false;
      this.net.connect(this.lobbyId, 'human', this.playerName || 'PLAYER');
    }
    if (screen === 'menu' || screen === 'title' || screen === 'highrollers') {
      if (!this.isAgentPage) this.net.leave();
      this.remote.clear(); this.remoteInfo.clear(); this.others = [];
    }
    this.screens.enter(screen);
  }

  /** called when the player picks a mode; multi-marble joins the shared world right away */
  beginMode(): void {
    if (this.mode === 'multi') this.net.connect('world', 'multi', this.playerName || 'PLAYER');
  }

  async start(): Promise<void> {
    void this.fetchRollers();
    const q = new URLSearchParams(location.search);
    if (q.has('debug')) this.debug = true;
    const stage = q.get('stage');
    if (stage) {
      this.playerName = 'TEST';
      this.newGame(Math.max(1, Math.min(STAGES.length, +stage)) - 1);
      return;
    }
    if (this.isAgentPage) {
      // an agent opened the lobby link: join as the AI marble and wait for the human to start
      this.mode = 'ai'; this.isAI = true; this.playerName = 'AGENT';
      this.net.connect(this.lobbyId, 'ai', 'AGENT');
      this.go('connect');
      return;
    }
    const userParam = q.get('user');
    if (userParam) {
      this.playerName = userParam;
      (window as any).__MM__ = { ...((window as any).__MM__ || {}), user: userParam };
    } else if ((window as any).__MM__?.user) {
      this.playerName = (window as any).__MM__.user;
    }
    this.go('title');
  }

  async submitScore(): Promise<void> {
    if (this.scoreSubmitted || this.score <= 0) return;
    this.scoreSubmitted = true;
    try {
      await fetch('/api/leaderboard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: this.playerName || '@MACEIP',
          score: this.score,
          intelligence: this.isAI ? 'Artificial' : 'Natural',
          stage: this.stageIdx + 1,
          timeRemaining: Math.floor(this.timeLeft),
          deaths: this.deaths,
        }),
      });
      await this.fetchRollers();
    } catch { /* offline */ }
  }
  isAI = false;

  async fetchRollers(): Promise<void> {
    try {
      const res = await fetch('/api/leaderboard');
      if (!res.ok) return;
      const j = await res.json() as { top50?: { name: string; score: number; intelligence?: string; rank?: number }[] };
      if (j.top50 && j.top50.length) {
        this.rollers = j.top50.slice(0, 10).map((e, i) => ({
          name: e.name,
          score: e.score,
          intelligence: e.intelligence || 'Natural',
          rank: e.rank ?? (i + 1),
        }));
      }
    } catch { /* offline */ }
  }

  newGame(stageIdx = 0): void {
    this.score = 0; this.displayScore = 0; this.deaths = 0; this.carried = 0; this.scoreSubmitted = false;
    void this.loadStage(stageIdx).then(() => this.go('intro'));
  }

  private litGoalBlue: HTMLImageElement | null = null;
  private litGoalRed: HTMLImageElement | null = null;

  async loadStage(idx: number): Promise<void> {
    this.stageIdx = idx;
    this.stage = STAGES[idx];
    this.stageImg = await this.assets.stage(this.stage.image);
    [this.litGoalBlue, this.litGoalRed] = await Promise.all([
      this.assets.goalLit(idx + 1, 'blue'),
      this.assets.goalLit(idx + 1, 'red'),
    ]);
    if (!this.stage.heightmap) {
      const hm = await loadHeightMap(this.stage);
      if (hm) attachHeightMap(this.stage, hm);
    }
    this.resetStageState();
  }

  /** seconds granted at the start of a race: NES table in 1P, arcade table in the 2P modes */
  timeAddFor(idx: number): number {
    if (this.mode === '1p') return STAGES[idx].timeAdd;
    return ARCADE_TIME_ADD[idx] ?? STAGES[idx].timeAdd;
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
    this.introPool = this.timeAddFor(this.stageIdx);
    this.wonPool = this.mode === 'ai' && this.wonLast ? WON_RACE_BONUS : 0;
    this.wonDone = 0; this.waitingT = 0;
    this.finished = false; this.oppFinished = false;
    this.timeLeft = s.carryTime ? this.carried : 0;
    // 2P: the agent's (red) marble starts beside the human's
    if (this.mode === 'ai' && this.isAgentPage) {
      if (s.start2) {
        const t2 = topAt(s, s.start2.u, s.start2.v);
        this.marble.place(s.start2.u, s.start2.v, s.start2.z ?? (t2 ? t2.z : this.marble.z));
      } else {
        const u = s.start.u + 1.2, v = s.start.v - 1.2;
        const t2 = supportAt(s, u, v, this.marble.z + 4, 8);
        this.marble.place(u, v, t2 ? t2.z : this.marble.z);
      }
    }
    // animated finish flags either side of the goal (animated_assets/FinishFlag.gif)
    this.goalFlags = [];
    const goal = s.zones.find((z) => z.kind === 'goal');
    if (goal) {
      const zRef = goal.zMin !== undefined ? goal.zMin + 4 : 0;
      for (const [u, v] of [[goal.u0 + 0.3, goal.v1 - 0.3], [goal.u1 - 0.3, goal.v0 + 0.3]]) {
        const sup = goal.zMin !== undefined ? supportAt(s, u, v, zRef + 20, 40) : topAt(s, u, v);
        if (sup) this.goalFlags.push({ u, v, z: sup.z });
      }
    }
    this.centerCameraOnMarble(true);
  }

  /* ---------------------------------------------------------------------- */
  /* update                                                                  */
  /* ---------------------------------------------------------------------- */

  /** human side: the agent may already be in the lobby (rematch, or it joined before we came back) */
  private checkLobbyStart(): void {
    if (this.mode !== 'ai' || this.isAgentPage || this.agentJoined) return;
    const ai = [...this.net.players.values()].find((p) => p.role === 'ai');
    if (ai) this.net.onJoined?.(ai);
  }

  update(dt: number): void {
    this.t += dt;
    if (this.screen === 'connect') this.checkLobbyStart();
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
    this.centerCameraOnMarble(false, dt);
    if (this.mode !== '1p') this.updateNet(dt);
    if (this.t < 0.6) return;
    if (this.wonPool > 0) {
      // arcade 2P: "WON LAST RACE: +5 sec" drains into the winner's timer before the race time does
      const take = Math.min(this.wonPool, 5 * dt);
      this.wonPool -= take;
      this.timeLeft = Math.min(TIME_CAP, this.timeLeft + take);
      this.introTick += take;
      if (this.introTick >= 1) { this.introTick -= 1; this.sound.sfx('tick', 0.35, 1.4); }
      if (this.wonPool <= 0.001) { this.wonPool = 0; this.wonDone = this.t; }
      return;
    }
    if (this.wonDone > 0 && this.t - this.wonDone < 0.8) return;
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
      this.beginStartSlide();
    }
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
      case 'time-gift':
        if (e.marble === this.marble) {
          this.timeLeft = Math.min(TIME_CAP, this.timeLeft + TIMEZONE_BONUS);
          this.timezoneTag = 1.2;
          this.sound.sfx('checkpoint', 0.6, 1.2);
        }
        break;
      case 'steelie-bump': break;
    }
  }

  private updateNet(dt: number): void {
    if (!this.net.lobby) return;
    this.net.update(dt);
    const m = this.marble;
    this.net.sendState(dt, { stage: this.stageIdx + 1, u: m.u, v: m.v, z: m.z, vu: m.vu, vv: m.vv, phase: m.phase, score: this.score, time: this.timeLeft, progress: (m.u + m.v) * this.stage.progressDir, fin: this.finished ? 1 : 0, deaths: this.deaths });
    // arcade 2P: a race ends for both once both have finished; remember when the opponent is done (or already ahead)
    for (const p of this.net.players.values()) {
      if (p.stage > this.stageIdx + 1 || (p.stage === this.stageIdx + 1 && p.fin)) this.oppFinished = true;
    }
    // mirror remote players into Marble objects (same stage only)
    const seen = new Set<string>();
    for (const p of this.net.players.values()) {
      if (p.stage !== this.stageIdx + 1) continue;
      seen.add(p.id);
      let rm = this.remote.get(p.id);
      if (!rm) { rm = new Marble(); this.remote.set(p.id, rm); }
      rm.u = p.u; rm.v = p.v; rm.z = p.z; rm.vu = p.vu; rm.vv = p.vv;
      rm.phase = (p.phase === 'alive' || p.phase === 'dying' || p.phase === 'dead' || p.phase === 'hidden') ? p.phase : 'alive';
      rm.rollDist += Math.hypot(p.vu, p.vv) * dt;
      this.remoteInfo.set(p.id, p);
    }
    for (const id of [...this.remote.keys()]) if (!seen.has(id)) { this.remote.delete(id); this.remoteInfo.delete(id); this.aiTrackers.delete(id); }
    this.others = [...this.remote.values()];
    // marble-marble bumps
    if (m.phase === 'alive' && !m.inPipe) {
      for (const [id, rm] of this.remote) {
        if (rm.phase !== 'alive') continue;
        const before = { vu: m.vu, vv: m.vv };
        if (m.collideBall(rm.u, rm.v, rm.z, rm.vu, rm.vv, 1, 1.1)) {
          this.sound.sfx('bounce', 0.7);
          this.net.sendBump(id, -(m.vu - before.vu) * 0.8, -(m.vv - before.vv) * 0.8);
        }
      }
    }
  }

  /** Player-vs-AI: camera follows whoever is further along; the trailing marble is teleported up with a penalty */
  private twoPlayerRule(dt: number): void {
    if (this.mode !== 'ai') return;
    const opp = this.others[0];
    if (!opp || opp.phase !== 'alive') return;
    // once the leader has finished the race, the other marble is left alone to finish on its own
    if (this.oppFinished || this.finished) { this.camOverride = null; return; }
    if (this.marble.slide) return;
    this.teleportCooldown = Math.max(0, this.teleportCooldown - dt);
    const m = this.marble;
    const myY = (m.u + m.v) * 4 - m.z, oppY = (opp.u + opp.v) * 4 - opp.z;
    const dir = this.stage.progressDir;
    const leadY = dir > 0 ? Math.max(myY, oppY) : Math.min(myY, oppY);
    const camTarget = clamp(leadY - 112, 0, Math.max(0, this.stage.height - VIEW_H));
    this.camOverride = camTarget;
    const behind = dir > 0 ? myY < this.r.cam.y - TWO_PLAYER_TRAIL_MARGIN : myY > this.r.cam.y + VIEW_H + TWO_PLAYER_TRAIL_MARGIN;
    if (behind && m.phase === 'alive' && this.teleportCooldown <= 0) {
      const top = topAt(this.stage, opp.u - 1.5, opp.v + 1.5) ?? topAt(this.stage, opp.u, opp.v);
      m.place(opp.u - 1.5, opp.v + 1.5, top ? top.z : opp.z);
      this.score = Math.max(0, this.score - TWO_PLAYER_TELEPORT_PENALTY);
      this.popups.push({ text: `-${TWO_PLAYER_TELEPORT_PENALTY}`, u: m.u, v: m.v, z: m.z, t: 0 });
      this.sound.sfx('fall', 0.8);
      this.teleportCooldown = 4;
    }
  }
  camOverride: number | null = null;

  private updateRace(dt: number): void {
    if (this.paused) return;
    const s = this.stage;
    this.raceTime += dt;
    this.updateNet(dt);
    this.twoPlayerRule(dt);
    // timer
    if (this.marble.phase === 'alive' || this.marble.phase === 'dying') {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) { this.timeLeft = 0; this.gameOver(); return; }
    }

    // marble physics
    let steer = this.input.sample(dt);
    if (s.reverseControls) steer = { ax: -steer.ax, ay: -steer.ay };
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

    // roll sound: marble surface rolling + mechanical trackball bearing loop
    const sp = this.marble.phase === 'alive' && this.marble.grounded && !this.marble.inPipe ? this.marble.speed / 15 : 0;
    this.sound.setRoll(sp);
    const tbSpeed = Math.hypot(this.input.trackball.wx, this.input.trackball.wy);
    this.sound.setTrackballRoll(tbSpeed);

    this.centerCameraOnMarble(false, dt);
  }

  private onMarbleEvent(e: MarbleEvent): void {
    switch (e.type) {
      case 'bounce':
        this.sound.sfx('bounce', Math.min(1, 0.3 + (e.speed ?? 0) * 0.06));
        this.input.trackball.vibrate(12); // Wall/barrier bounce
        break;
      case 'land':
        if ((e.fall ?? 0) > 6) {
          this.sound.sfx('bounce', 0.5, 0.8);
          this.input.trackball.vibrate(25); // Drop landing after vertical drop
        }
        break;
      case 'dizzy':
        this.sound.sfx('fall', 0.7);
        this.input.trackball.vibrate(25);
        break;
      case 'die':
        this.deaths++;
        if (e.kind === 'shatter' || e.kind === 'void' || e.kind === 'zap') this.sound.sfx('shatter');
        else if (e.kind === 'squeeze') this.sound.sfx('muncher');
        this.input.trackball.vibrate([15, 30, 40]); // Ledge fall / shatter
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
    } else { this.timezoneTag = Math.max(0, this.timezoneTag - 1 / 60); this.timezoneT = 0; }
  }
  private pendingPipeBonus = 0;

  award(points: number, at: { u: number; v: number; z: number }): void {
    this.score += points;
    this.popups.push({ text: String(points), u: at.u, v: at.v, z: at.z, t: 0 });
    this.sound.sfx('item');
  }

  private reachGoal(): void {
    this.finished = true;
    this.wonLast = this.mode === 'ai' && !this.oppFinished;
    this.sound.stopBgm();
    this.sound.stopRoll();
    this.sound.sfx('goal');
    this.marble.vu *= 0.3; this.marble.vv *= 0.3;
    this.bonusTotal = Math.floor(this.timeLeft) * TIME_BONUS_PER_SEC;
    this.bonusCount = 0;
    this.go('timebonus');
  }

  /** 2P: is there an opponent still racing this stage (alive with time on the clock)? */
  opponentRacing(): boolean {
    if (this.mode !== 'ai') return false;
    for (const p of this.net.players.values()) {
      if (p.stage === this.stageIdx + 1 && !p.fin && p.time > 0.05 && performance.now() - p.lastSeen < 6000) return true;
    }
    return false;
  }

  private updateTimeBonus(dt: number): void {
    if (this.mode !== '1p') this.updateNet(dt);
    // marble keeps rolling to a stop
    const ev: MarbleEvent[] = [];
    this.marble.step(this.stage, { ax: 0, ay: 0 }, dt, ev);
    if (this.mode === 'ai' && this.others[0] && this.bonusCount >= this.bonusTotal) {
      // watch the opponent finish
      const o = this.others[0];
      const oy = (o.u + o.v) * 4 - o.z;
      this.camOverride = clamp(oy - 112, 0, Math.max(0, this.stage.height - VIEW_H));
      const k = Math.min(1, dt * 4);
      this.r.cam.y += (this.camOverride - this.r.cam.y) * k;
    } else this.centerCameraOnMarble(false, dt);
    if (this.t > 1.0 && this.bonusCount < this.bonusTotal) {
      const step = Math.min(this.bonusTotal - this.bonusCount, Math.ceil(this.bonusTotal * dt / 1.4 / 100) * 100);
      this.bonusCount += step; this.score += step;
      this.tickAcc += dt; if (this.tickAcc > 0.08) { this.tickAcc = 0; this.sound.sfx('tick', 0.3, 1.2); }
    }
    if (this.bonusCount >= this.bonusTotal && this.t > 2.6) {
      if (!this.oppFinished && this.opponentRacing()) { this.waitingT += dt; return; }
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

  /** Aerial-style starting ramps: the marble rides a scripted path with no control until it lands */
  beginStartSlide(): void {
    const s = this.stage;
    const st = this.mode === 'ai' && this.isAgentPage && s.start2 ? s.start2 : s.start;
    if (st.slide !== undefined && s.slides[st.slide]) this.marble.beginSlide(s.slides[st.slide]);
  }

  respawn(): void {
    const s = this.stage;
    let cp = s.checkpoints[Math.min(this.checkpointIdx, s.checkpoints.length - 1)] ?? s.start;
    if (this.pendingRespawnAtStart) { cp = s.start; this.checkpointIdx = 0; this.pendingRespawnAtStart = false; }
    const top = topAt(s, cp.u, cp.v);
    this.marble.place(cp.u, cp.v, top ? top.z : 0);
    if (this.checkpointIdx === 0 || cp === s.start) this.beginStartSlide();
    this.progressMax = Math.max(this.progressMax, -Infinity);
    this.respawnT = 0;
  }

  /** stage-start camera (top of course) or follow */
  centerCameraOnMarble(snap: boolean, dt = 0): void {
    if (!this.stageImg) return;
    const m = this.marble;
    const my = (m.u + m.v) * 4 - m.z;
    const vh = this.r.viewH;
    const vw = this.r.viewW;
    let targetY = clamp(my - vh * 0.45, 0, Math.max(0, this.stage.height - vh));
    if (this.camOverride !== null && this.screen === 'race') { targetY = this.camOverride; }
    const targetX = clamp(this.stage.viewX0, 0, Math.max(0, this.stage.width - vw));
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
        r.present();
        this.renderAITracker();
        break;
      case 'title': case 'menu': case 'name': case 'connect':
        this.screens.render();
        break;
      default:
        this.screens.render();
        r.present();
    }
  }

  private renderRace(): void {
    const r = this.r;
    if (!this.stageImg) { r.clear(); return; }
    r.drawStage(this.stageImg, this.stage);
    if (this.goalReached || this.finished || this.oppFinished) {
      const isBlue = this.wonLast || !this.oppFinished;
      const overlay = isBlue ? this.litGoalBlue : this.litGoalRed;
      if (overlay) r.drawLitGoal(overlay, this.stageIdx + 1);
    }
    const sprites: Sprite[] = [];
    const ctx = this.hazardCtx(0);
    for (const h of this.hazards) h.sprites(ctx, sprites);
    this.marbleSprites(this.marble, this.isAI, sprites);
    for (const [id, o] of this.remote) {
      const info = this.remoteInfo.get(id);
      this.marbleSprites(o, info?.role === 'ai', sprites);
    }
    // finish flags (blue left, red right) waving at the goal
    if (FRAMES.flagBlue.length) {
      this.goalFlags.forEach((f, i) => {
        const fr = i === 0 ? FRAMES.flagBlue : FRAMES.flagRed;
        const img = i === 0 ? this.assets.sheets.flagBlue : this.assets.sheets.flagRed;
        const fi = Math.floor((this.raceTime + this.t) * 30) % fr.length;
        out_flag(sprites, img, fr[(fi + fr.length) % fr.length], f);
      });
    }
    r.drawSprites(sprites);
    for (const h of this.hazards) h.drawOverlay?.(r.ctx, (u, v, z) => r.project(u, v, z), this.raceTime);
    this.drawDeathParticles(this.marble);
    for (const o of this.others) this.drawDeathParticles(o);
    // 2D callouts anchored to the (3D) marble positions
    for (const [id, o] of this.remote) {
      if (o.phase === 'hidden') continue;
      const info = this.remoteInfo.get(id);
      if (info?.role === 'ai' || (this.mode === 'ai' && !this.isAgentPage)) continue;
      const p = r.project(o.u, o.v, o.z);
      const tag = (info?.name ?? 'P2').slice(0, 6);
      const w = r.font.width(tag) + 4;
      const bx = Math.round(p.x - w / 2), by = p.y - 34;
      r.ctx.strokeStyle = '#8a90e6'; r.ctx.lineWidth = 1;
      r.ctx.beginPath(); r.ctx.moveTo(p.x + 0.5, by + 10); r.ctx.lineTo(p.x + 0.5, p.y - 14); r.ctx.stroke();
      r.ctx.fillStyle = '#000'; r.ctx.fillRect(bx, by, w, 10);
      r.ctx.strokeRect(bx + 0.5, by + 0.5, w - 1, 9);
      r.font.draw(r.ctx, tag, bx + 2, by + 1, 'lavender');
    }

    const labels: Label[] = [];
    for (const p of this.popups) labels.push({ text: p.text, u: p.u, v: p.v, z: p.z, dy: -20 - Math.min(6, p.t * 6) });
    if (this.timezoneTag && this.marble.phase === 'alive') {
      labels.push({ text: `+${TIMEZONE_BONUS}`, u: this.marble.u, v: this.marble.v, z: this.marble.z, dy: -30 });
      labels.push({ text: 'SEC', u: this.marble.u, v: this.marble.v, z: this.marble.z, dy: -22 });
    }
    r.drawLabels(labels);

    if (this.debug) this.renderDebug();

    // HUD (arcade 2P layout in Player-vs-AI: P1 blue left, P2 red right)
    if (this.mode === 'ai') {
      const opp = [...this.net.players.values()].find((p) => p.role !== (this.isAgentPage ? 'ai' : 'human'));
      const me = { score: fmtScore(this.displayScore), time: fmtTime(this.timeLeft) };
      const them = { score: fmtScore(opp?.score ?? 0), time: fmtTime(opp?.time ?? 0) };
      if (this.isAgentPage) r.drawHud2P(them, me); else r.drawHud2P(me, them);
    } else r.drawHud(fmtScore(this.displayScore), fmtTime(this.timeLeft));
    if (this.toast.t > 0) {
      r.ctx.fillStyle = 'rgba(0,0,0,0.75)'; r.ctx.fillRect(0, VIEW_H - 12, VIEW_W, 12);
      r.text(this.toast.text.slice(0, 36), 2, VIEW_H - 10, 'orange');
    }

    if (this.screen === 'intro') {
      const title = this.stage.name;
      const bw = 232, bh = 30; const bx = (VIEW_W - bw) / 2, by = 36;
      const showWon = this.wonPool > 0 || (this.wonDone > 0 && this.t - this.wonDone < 0.8);
      r.drawBox(bx, by, bw, bh);
      if (showWon) {
        // arcade 2P: the previous race's winner banks extra seconds first
        r.text('WON LAST RACE:', bx + 40, by + 11, 'orange');
        r.text(`+${Math.ceil(this.wonPool)} SEC`, bx + bw - 60, by + 11, 'cyan');
      } else {
        const extra = this.mode !== '1p' && this.stageIdx >= 2;
        r.text(extra ? 'EXTRA TIME FOR' : 'TIME TO FINISH', bx + 36, by + 6, 'orange');
        r.text(title + ':', bx + 44, by + 16, 'cyan');
        const n = fmtTime(this.introPool);
        r.ctx.fillStyle = '#7d7d7d'; r.ctx.fillRect(bx + bw - 34, by + 6, 28, 18);
        if (extra) r.text('+', bx + bw - 42, by + 11, 'cyan');
        r.font.drawBig(r.ctx, n, bx + bw - 32, by + 8);
      }
      if (this.stage.reverseControls) {
        r.drawBox(bx, by + bh + 4, bw, 14);
        r.textC('EVERYTHING YOU KNOW IS WRONG', VIEW_W / 2, by + bh + 7, 'orange');
      }
    }
    if (this.screen === 'timebonus') {
      if (this.mode === 'ai') {
        // arcade wording: "BONUS FOR TIME LEFT: 5,300" in the finisher's colour
        const bw = 236, bh = 16; const bx = (VIEW_W - bw) / 2, by = 40;
        r.drawBox(bx, by, bw, bh);
        const col = this.isAgentPage ? '#ff5a5a' : '#5a7cff';
        r.textTinted('BONUS FOR TIME LEFT:', bx + 6, by + 4, col);
        r.textTinted(fmtScore(this.bonusCount), bx + bw - 6 - r.font.width(fmtScore(this.bonusCount)), by + 4, col);
        if (this.waitingT > 0.5 && this.fade === 0) {
          r.drawBox(bx, by + bh + 4, bw, 14);
          r.textC(this.isAgentPage ? 'WAITING FOR LEFT PLAYER' : 'WAITING FOR RIGHT PLAYER', VIEW_W / 2, by + bh + 7, 'orange');
        }
      } else {
        const bw = 96, bh = 46; const bx = 20, by = 40;
        r.drawBox(bx, by, bw, bh);
        r.textC('TIME', bx + bw / 2, by + 6, 'lavender');
        r.textC('BONUS', bx + bw / 2, by + 18, 'lavender');
        r.textC(fmtScore(this.bonusCount), bx + bw / 2, by + 32, 'lavender');
      }
      if (this.fade > 0) { r.ctx.fillStyle = `rgba(0,0,0,${this.fade})`; r.ctx.fillRect(0, 0, VIEW_W, VIEW_H); }
    }
  }

  private renderAITracker(): void {
    const r = this.r;
    // Don't render tracker on the AI agent's own screen; only on human player view
    if (this.isAgentPage) return;

    for (const [id, o] of this.remote) {
      const info = this.remoteInfo.get(id);
      const isAI = info?.role === 'ai' || (this.mode === 'ai' && !this.isAgentPage);
      if (!isAI || o.phase === 'hidden') continue;

      let tracker = this.aiTrackers.get(id);
      if (!tracker) {
        tracker = new AITrackerOverlay();
        this.aiTrackers.set(id, tracker);
      }

      // Project 3D isometric position to 2D screen coordinates
      const p = r.project(o.u, o.v, o.z);
      const screenX = (p.x / r.viewW) * r.canvas.width;
      const screenY = (p.y / r.viewH) * r.canvas.height;
      const vx = (o.vu - o.vv) * 8 * (r.canvas.width / r.viewW);
      const vy = ((o.vu + o.vv) * 4 - o.vz) * (r.canvas.height / r.viewH);

      tracker.render(
        r.screenCtx,
        {
          id,
          name: info?.name || 'AGENT',
          role: 'ai',
          screenX,
          screenY,
          worldZ: o.z,
          vx,
          vy,
          visible: o.phase === 'alive',
        },
        r.canvas.width,
        r.canvas.height,
        this.raceTime,
      );
    }
  }

  private renderDebug(): void {
    const r = this.r; const ctx = r.ctx;
    const hm = this.stage.heightmap;
    // coloured component overlay (built once per stage)
    if (hm && (this.debugStageId !== this.stage.id || !this.debugCanvas)) {
      const c = document.createElement('canvas'); c.width = hm.width; c.height = hm.height;
      const cx = c.getContext('2d')!; const img = cx.createImageData(hm.width, hm.height);
      for (let i = 0; i < hm.labels.length; i++) {
        const id = hm.labels[i]; if (!id) continue;
        const h = (id * 47) % 360; const rgb = hsl(h, 0.9, 0.5);
        img.data[i * 4] = rgb[0]; img.data[i * 4 + 1] = rgb[1]; img.data[i * 4 + 2] = rgb[2]; img.data[i * 4 + 3] = 90;
      }
      cx.putImageData(img, 0, 0);
      this.debugCanvas = c; this.debugStageId = this.stage.id;
    }
    if (this.debugCanvas) ctx.drawImage(this.debugCanvas, r.cam.x, r.cam.y, VIEW_W, VIEW_H, 0, 0, VIEW_W, VIEW_H);
    // manual surfaces as outlines (walls red, floors cyan)
    for (const s of this.stage.manualSurfaces) {
      const pts = surfaceMapPolygon(s);
      ctx.strokeStyle = s.kind === 'wall' ? 'rgba(255,60,60,0.9)' : 'rgba(80,255,255,0.9)';
      ctx.beginPath();
      pts.forEach((p, i) => { const x = p.x - r.cam.x, y = p.y - r.cam.y; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
      ctx.closePath(); ctx.stroke();
    }
    // component heights at their centroids (only those on screen)
    if (hm) {
      for (const c of hm.comps) {
        const [x0, y0, x1, y1] = c.bbox; const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        const zc = c.a + c.b * cx + c.c * cy; const sy = cy - r.cam.y;
        if (sy < 0 || sy > VIEW_H) continue;
        r.text(`${c.id}:${Math.round(zc)}`, Math.round(cx - r.cam.x) - 8, Math.round(sy), 'white');
      }
    }
    // marble readout
    const m = this.marble;
    const mx = Math.round((m.u - m.v) * 8), my = Math.round((m.u + m.v) * 4 - m.z);
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(0, 30, 150, 30);
    r.text(`PX ${mx},${my} Z${Math.round(m.z)}`, 2, 32, 'cyan');
    r.text(`${(m.support ? m.support.s.name ?? '' : 'AIR').toUpperCase().slice(0, 14)} ${m.grounded ? '' : 'FALL'}`, 2, 42, 'cyan');
    r.text(`U${m.u.toFixed(1)} V${m.v.toFixed(1)} S${m.speed.toFixed(1)}`, 2, 52, 'cyan');
  }

  /** blue droplets flying out of a dissolving / vacuumed / zapped marble */
  private drawDeathParticles(m: Marble): void {
    if (m.phase !== 'dying') return;
    const t = m.deathT;
    let start = 0, dur = 0;
    if (m.deathKind === 'dissolve') { start = 0.45; dur = 0.9; }
    else if (m.deathKind === 'zap') { start = 0.3; dur = 1.2; }
    else if (m.deathKind === 'squeeze') { start = 0.7; dur = 0.5; }
    else return;
    if (t < start || t > start + dur) return;
    const k = (t - start) / dur;
    const p = this.r.project(m.u, m.v, m.z);
    const ctx = this.r.ctx;
    ctx.fillStyle = '#4b6cff';
    for (let i = 0; i < 9; i++) {
      const a = i * 0.7 + 0.3, sp = 26 + (i % 3) * 9;
      const x = p.x + Math.cos(a) * sp * k, y = p.y - 6 - Math.sin(a) * 14 * k + 40 * k * k;
      ctx.fillRect(Math.round(x), Math.round(y), 2, 2);
    }
  }

  /** choose marble frame(s) from its state */
  marbleSprites(m: Marble, red: boolean | undefined, out: Sprite[]): void {
    const F = FRAMES.marble;
    const img = red ? this.assets.sheets.marbleRed : this.assets.sheets.marble;
    if (m.phase === 'hidden' || m.inPipe) return;
    const base = { img, u: m.u, v: m.v, z: m.z, dy: -8 };
    const groundZ = m.support ? m.support.z : m.z;
    // rolling: NES Player1Rolling / Player2Rolling (16 frames); effects keep coming from marble_effects
    const rollF = red ? FRAMES.p2roll : FRAMES.p1roll;
    const rollImg = red ? this.assets.sheets.p2roll : this.assets.sheets.p1roll;
    const rollSprite = (k: number): { img: HTMLImageElement; frame: Frame } =>
      rollF.length ? { img: rollImg, frame: rollF[((Math.floor(k) % rollF.length) + rollF.length) % rollF.length] } : { img, frame: F.roll[Math.floor(k) % F.roll.length] };
    if (m.phase === 'alive') {
      if (m.dizzyT > 0) { out.push({ ...base, frame: F.dizzy[Math.floor(m.dizzyT * 12) % F.dizzy.length], shadowZ: m.grounded ? 0 : m.z - groundZ }); return; }
      const rs = rollSprite(m.rollDist * 3.2);
      out.push({ ...base, img: rs.img, frame: rs.frame, shadowZ: m.grounded ? 0 : m.z - groundZ });
      if ((this.goalReached || this.finished) && Math.floor(this.t * 8) % 2 === 0 && F.sparkle && F.sparkle.length) {
        out.push({ ...base, frame: F.sparkle[0], dy: -18, alpha: 0.95 });
      }
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
        case 'dissolve': if (t < 0.6) out.push({ ...base, frame: F.dissolve[Math.min(3, Math.floor(t / 0.15))] }); break;
        case 'crush': if (t > 0.3) out.push({ ...base, frame: F.pile[0] }); break;
        case 'void': {
          // keeps falling out of view
          const rs = rollSprite(t * 40);
          out.push({ ...base, img: rs.img, frame: rs.frame, z: m.z - t * 260, alpha: Math.max(0, 1 - t) });
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

function out_flag(out: Sprite[], img: HTMLImageElement, frame: Frame, at: { u: number; v: number; z: number }): void {
  out.push({ img, frame, u: at.u, v: at.v, z: at.z, dy: 0, depthBias: 1 });
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

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
