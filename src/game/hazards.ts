import { StageDef, HazardSpawn, topAt, supportAt } from '../engine/level';
import { Marble, MarbleEvent } from '../engine/physics';
import { Sprite } from '../render/renderer';
import { Assets, FRAMES, Frame } from '../engine/assets';
import { WAND_FREEZE, MARBLE_R } from '../engine/constants';
import { screenDirToWorld } from '../engine/iso';

export interface HazardContext {
  level: StageDef;
  assets: Assets;
  marbles: Marble[];              // all marbles that can be hurt (local + remote in 2P)
  local: Marble;
  time: number;                   // race time elapsed
  rng: () => number;
  onEvent: (e: HazardEvent) => void;
}

export type HazardEvent =
  | { type: 'wand'; marble: Marble }
  | { type: 'bird-zap'; marble: Marble }
  | { type: 'sfx'; name: 'muncher' | 'bounce' | 'shatter' | 'springboard' | 'item' | 'fall' | 'checkpoint'; vol?: number }
  | { type: 'steelie-bump'; marble: Marble };

export type Project = (u: number, v: number, z: number) => { x: number; y: number };

export abstract class Hazard {
  u: number; v: number; z = 0;
  constructor(public spawn: HazardSpawn) { this.u = spawn.u; this.v = spawn.v; }
  abstract update(dt: number, ctx: HazardContext): void;
  abstract sprites(ctx: HazardContext, out: Sprite[]): void;
  /** optional custom drawing on top of the sprites (waves, suction lines) */
  drawOverlay?(ctx2d: CanvasRenderingContext2D, project: Project, time: number): void;
  /** called when the marble respawns / stage restarts */
  reset(ctx: HazardContext): void { void ctx; }
}

function dist(a: { u: number; v: number }, b: { u: number; v: number }): number {
  return Math.hypot(a.u - b.u, a.v - b.v);
}

/* ------------------------------------------------------------------------ */
/* Steelie: black marble that hunts the player                              */
/* ------------------------------------------------------------------------ */
export class Steelie extends Hazard {
  ball = new Marble();
  wanderT = 0;
  wu = 0; wv = 0;
  active = true;
  respawnT = 0;

  reset(ctx: HazardContext): void {
    const top = topAt(ctx.level, this.spawn.u, this.spawn.v);
    this.ball.place(this.spawn.u, this.spawn.v, top ? top.z : 0);
    this.active = true;
  }

  update(dt: number, ctx: HazardContext): void {
    if (!this.active) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) this.reset(ctx);
      return;
    }
    const b = this.ball;
    const target = ctx.local;
    let ax = 0, ay = 0;
    const d = dist(b, target);
    if (target.phase === 'alive' && d < 14 && Math.abs(target.z - b.z) < 30) {
      const dx = target.u - b.u, dy = target.v - b.v;
      ax = (dx - dy) * 0.5; ay = (dx + dy) * 0.5;
      const m = Math.hypot(ax, ay) || 1; ax /= m; ay /= m;
      ax *= 0.75; ay *= 0.75;
    } else {
      this.wanderT -= dt;
      if (this.wanderT <= 0) { this.wanderT = 0.8 + ctx.rng() * 1.2; const a = ctx.rng() * Math.PI * 2; this.wu = Math.cos(a) * 0.4; this.wv = Math.sin(a) * 0.4; }
      ax = this.wu; ay = this.wv;
    }
    const ev: MarbleEvent[] = [];
    b.step(ctx.level, { ax, ay }, dt, ev);
    if (b.phase !== 'alive') { this.active = false; this.respawnT = 3; return; }
    for (const m of ctx.marbles) {
      if (m.phase !== 'alive' || m.inPipe) continue;
      const before = m.speed;
      if (m.collideBall(b.u, b.v, b.z, b.vu, b.vv, 2.2, MARBLE_R * 2)) {
        const dx = b.u - m.u, dy = b.v - m.v; const dd = Math.hypot(dx, dy) || 1;
        b.vu += (dx / dd) * 2; b.vv += (dy / dd) * 2;
        ctx.onEvent({ type: 'sfx', name: 'bounce', vol: Math.min(1, 0.4 + before * 0.06) });
        ctx.onEvent({ type: 'steelie-bump', marble: m });
      }
    }
  }

  sprites(ctx: HazardContext, out: Sprite[]): void {
    if (!this.active) return;
    const b = this.ball;
    out.push({ img: ctx.assets.sheets.objects, frame: FRAMES.objects.steelie[0], u: b.u, v: b.v, z: b.z, dy: -6, shadowZ: b.grounded ? 0 : b.z - (b.support?.z ?? b.z) });
  }
}

/* ------------------------------------------------------------------------ */
/* Worm / Marble Muncher: slinkies end-over-end, eats the marble            */
/* ------------------------------------------------------------------------ */
const WORM_WALK = [0, 2, 4, 5, 9, 10, 13, 16, 20, 22, 24];
const WORM_EAT = [7, 8, 12, 8, 7];

export class Worm extends Hazard {
  t = 0;
  dirU = 1; dirV = 0;
  eating = 0;
  stunned = 0;

  reset(ctx: HazardContext): void {
    this.u = this.spawn.u; this.v = this.spawn.v;
    const top = topAt(ctx.level, this.u, this.v); this.z = top ? top.z : 0;
    this.eating = 0; this.stunned = 0;
  }

  update(dt: number, ctx: HazardContext): void {
    this.t += dt;
    if (this.eating > 0) { this.eating -= dt; return; }
    if (this.stunned > 0) { this.stunned -= dt; }
    const range = this.spawn.range ?? 6;
    const target = ctx.local;
    const d = dist(this, target);
    let tu: number, tv: number;
    if (target.phase === 'alive' && d < 9 && Math.abs(target.z - this.z) < 12) { tu = target.u; tv = target.v; }
    else { tu = this.spawn.u + Math.sin(this.t * 0.5) * range * 0.6; tv = this.spawn.v + Math.cos(this.t * 0.37) * range * 0.6; }
    const dx = tu - this.u, dy = tv - this.v; const m = Math.hypot(dx, dy) || 1;
    if (m > 0.3) { this.dirU = dx / m; this.dirV = dy / m; }
    const speed = this.stunned > 0 ? 0 : 2.1;
    const pulse = Math.max(0, Math.sin(this.t * 4.5));
    const nu = this.u + this.dirU * speed * pulse * dt * 1.6;
    const nv = this.v + this.dirV * speed * pulse * dt * 1.6;
    const sup = supportAt(ctx.level, nu, nv, this.z + 4, 6);
    if (sup && Math.abs(sup.z - this.z) < 6 && dist({ u: nu, v: nv }, this.spawn) < range + 1) { this.u = nu; this.v = nv; this.z = sup.z; }
    else { this.dirU = -this.dirU; this.dirV = -this.dirV; }
    for (const mb of ctx.marbles) {
      if (mb.phase !== 'alive' || mb.inPipe) continue;
      const dd = dist(this, mb);
      if (dd < 1.0 && Math.abs(mb.z - this.z) < 10) {
        if (mb.speed > 7 && this.stunned <= 0) {
          this.stunned = 1.2;
          const kx = (this.u - mb.u) / (dd || 1), ky = (this.v - mb.v) / (dd || 1);
          this.u += kx * 1.2; this.v += ky * 1.2;
          mb.vu *= -0.4; mb.vv *= -0.4;
          ctx.onEvent({ type: 'sfx', name: 'bounce' });
        } else if (this.stunned <= 0) {
          mb.squeezeDir = (mb.u - mb.v) < (this.u - this.v) ? 1 : -1;
          mb.u = this.u; mb.v = this.v;
          mb.die('squeeze');
          this.eating = 1.4;
          ctx.onEvent({ type: 'sfx', name: 'muncher' });
        }
      }
    }
  }

  sprites(ctx: HazardContext, out: Sprite[]): void {
    const frames = FRAMES.worm;
    let f: Frame;
    if (this.eating > 0) {
      const k = Math.min(WORM_EAT.length - 1, Math.floor((1.4 - this.eating) / 1.4 * WORM_EAT.length));
      f = frames[WORM_EAT[k]];
    } else if (this.stunned > 0) {
      f = frames[15];
    } else {
      const k = Math.floor((this.t * 4.5 / (Math.PI * 2)) * WORM_WALK.length) % WORM_WALK.length;
      f = frames[WORM_WALK[k]];
    }
    const flip = this.dirU - this.dirV < 0;
    out.push({ img: ctx.assets.sheets.worm, frame: f, u: this.u, v: this.v, z: this.z, dy: 2, flip, depthBias: 1 });
  }
}

/* ------------------------------------------------------------------------ */
/* Slime / acid puddle: stays in one spot wandering a few tiles; dissolves  */
/* the marble on contact (review clip: marble melts into drops).            */
/* ------------------------------------------------------------------------ */
export class Slime extends Hazard {
  t = 0;
  phase = 0;
  reset(ctx: HazardContext): void {
    this.u = this.spawn.u; this.v = this.spawn.v;
    const top = topAt(ctx.level, this.u, this.v); this.z = top ? top.z : 0;
    this.phase = ctx.rng() * 100;
  }
  update(dt: number, ctx: HazardContext): void {
    this.t += dt;
    const range = this.spawn.range ?? 2;
    const tu = this.spawn.u + Math.sin(this.t * 0.45 + this.phase) * range;
    const tv = this.spawn.v + Math.sin(this.t * 0.31 + this.phase * 1.7) * range;
    const sup = supportAt(ctx.level, tu, tv, this.z + 4, 6);
    if (sup && Math.abs(sup.z - this.z) < 6) { this.u = tu; this.v = tv; this.z = sup.z; }
    for (const mb of ctx.marbles) {
      if (mb.phase !== 'alive' || mb.inPipe || !mb.grounded) continue;
      if (dist(this, mb) < 0.9 && Math.abs(mb.z - this.z) < 8) {
        mb.u = this.u; mb.v = this.v;
        mb.die('dissolve');
        ctx.onEvent({ type: 'sfx', name: 'fall', vol: 0.8 });
      }
    }
  }
  sprites(ctx: HazardContext, out: Sprite[]): void {
    const frames = FRAMES.slime;
    const f = frames[Math.floor(this.t * 6 + this.phase) % frames.length];
    out.push({ img: ctx.assets.sheets.slime, frame: f, u: this.u, v: this.v, z: this.z, dy: 0, depthBias: -2 });
  }
}

/* ------------------------------------------------------------------------ */
/* Hammer: a mallet that swings round its pivot like a clock hand and       */
/* flattens anything the head sweeps over (review clip: intermedidate_hammers) */
/* ------------------------------------------------------------------------ */
export class Hammer extends Hazard {
  t = 0;
  reset(ctx: HazardContext): void {
    const top = topAt(ctx.level, this.spawn.u, this.spawn.v); this.z = top ? top.z : 0;
    this.t = this.spawn.phase ?? 0;
  }
  /** current angle of the handle in screen space (0 = pointing right, grows clockwise) */
  angle(): number { const p = this.spawn.period ?? 2.4; return ((this.t % p) / p) * Math.PI * 2 * (this.spawn.facing === -1 ? -1 : 1); }
  /** world position of the head */
  head(): { u: number; v: number } {
    const a = this.angle(); const R = 14;
    const d = screenDirToWorld(Math.cos(a) * R / 8, Math.sin(a) * R / 8);
    // screenDirToWorld preserves magnitude in tiles; scale so the head is ~1.75 tiles out
    const m = Math.hypot(d.du, d.dv) || 1;
    return { u: this.u + (d.du / m) * 1.75, v: this.v + (d.dv / m) * 1.75 };
  }
  update(dt: number, ctx: HazardContext): void {
    this.t += dt;
    const h = this.head();
    for (const mb of ctx.marbles) {
      if (mb.phase !== 'alive' || mb.inPipe) continue;
      if (dist(h, mb) < 0.95 && Math.abs(mb.z - this.z) < 12) {
        mb.die('crush');
        ctx.onEvent({ type: 'sfx', name: 'shatter' });
      }
    }
  }
  sprites(ctx: HazardContext, out: Sprite[]): void {
    const frames = FRAMES.hammer;
    const a = ((this.angle() % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const idx = Math.floor(a / (Math.PI * 2) * frames.length) % frames.length;
    out.push({ img: ctx.assets.sheets.hammer, frame: frames[idx], u: this.u, v: this.v, z: this.z, dy: 4, depthBias: 3 });
  }
}

/* ------------------------------------------------------------------------ */
/* Vacuum: a box on the floor that inhales a marble rolling past its mouth  */
/* (review clip: vaccum_review).                                            */
/* ------------------------------------------------------------------------ */
export class Vacuum extends Hazard {
  t = 0;
  pull = 0;          // 0..1 how hard it is currently sucking
  swallow = 0;
  reset(ctx: HazardContext): void {
    const top = topAt(ctx.level, this.spawn.u, this.spawn.v); this.z = top ? top.z : 0;
    this.t = this.spawn.phase ?? 0; this.pull = 0; this.swallow = 0;
  }
  update(dt: number, ctx: HazardContext): void {
    this.t += dt;
    if (this.swallow > 0) this.swallow -= dt;
    let sucking = false;
    const R = this.spawn.range ?? 3.4;
    for (const mb of ctx.marbles) {
      if (mb.phase !== 'alive' || mb.inPipe) continue;
      const d = dist(this, mb);
      if (d < R && Math.abs(mb.z - this.z) < 12) {
        sucking = true;
        const k = (1 - d / R) * 30 * dt;
        mb.impU += (this.u - mb.u) / (d || 1) * k; mb.impV += (this.v - mb.v) / (d || 1) * k;
        if (d < 0.9) {
          mb.squeezeDir = (mb.u - mb.v) < (this.u - this.v) ? 1 : -1;
          mb.die('squeeze');
          this.swallow = 1.2;
          ctx.onEvent({ type: 'sfx', name: 'springboard' });
        }
      }
    }
    this.pull += ((sucking || this.swallow > 0 ? 1 : 0) - this.pull) * Math.min(1, dt * 6);
  }
  sprites(ctx: HazardContext, out: Sprite[]): void {
    const frames = FRAMES.vacuum;
    // idle: slot barely moves; sucking: mouth animation runs through the frames
    const idx = this.pull > 0.2 ? Math.floor(this.t * 12) % frames.length : Math.floor(this.t * 1.5) % 3;
    out.push({ img: ctx.assets.sheets.vacuum, frame: frames[idx], u: this.u, v: this.v, z: this.z, dy: 3, flip: this.spawn.facing === -1, depthBias: 2 });
  }
}

/* ------------------------------------------------------------------------ */
/* Risers: a pad of pistons that pop up in a travelling wave. Up pistons    */
/* block; a piston rising under the marble launches it ("catapult").        */
/* (review clip: aerial_race_catapault_and_risers)                          */
/* ------------------------------------------------------------------------ */
interface Piston { u: number; v: number; phase: number; rise: number; wasUp: boolean }
export class Risers extends Hazard {
  t = 0;
  pistons: Piston[] = [];
  reset(ctx: HazardContext): void {
    const top = topAt(ctx.level, this.spawn.u, this.spawn.v); this.z = top ? top.z : 0;
    const [nu, nv] = this.spawn.size ?? [3, 3];
    this.pistons = [];
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      this.pistons.push({ u: this.spawn.u + (i - (nu - 1) / 2), v: this.spawn.v + (j - (nv - 1) / 2), phase: (i + j) * 0.18 + (this.spawn.phase ?? 0), rise: 0, wasUp: false });
    }
    this.t = 0;
  }
  private riseAt(p: Piston): number {
    const period = this.spawn.period ?? 3.2;
    const c = (((this.t + p.phase) % period) + period) % period / period;
    if (c < 0.55) return 0;
    if (c < 0.65) return (c - 0.55) / 0.10;
    if (c < 0.90) return 1;
    return 1 - (c - 0.90) / 0.10;
  }
  update(dt: number, ctx: HazardContext): void {
    this.t += dt;
    const launch = this.spawn.launch ?? { du: 0, dv: 0 };
    for (const p of this.pistons) {
      const before = p.rise;
      p.rise = this.riseAt(p);
      for (const mb of ctx.marbles) {
        if (mb.phase !== 'alive' || mb.inPipe) continue;
        const d = dist(p, mb);
        if (d > 0.9 || Math.abs(mb.z - this.z) > 16) continue;
        if (before <= 0.05 && p.rise > 0.05 && mb.grounded && d < 0.7) {
          // popped underneath: catapult
          mb.grounded = false; mb.vz = 150; mb.maxZ = mb.z; mb.airT = 0;
          mb.vu += launch.du; mb.vv += launch.dv;
          ctx.onEvent({ type: 'sfx', name: 'springboard' });
        } else if (p.rise > 0.4 && mb.grounded) {
          // solid piston: shove the marble off it
          const k = (0.9 - d) * 22 * dt + 0.02;
          mb.impU += (mb.u - p.u) / (d || 1) * k; mb.impV += (mb.v - p.v) / (d || 1) * k;
          mb.u += (mb.u - p.u) / (d || 1) * Math.max(0, 0.75 - d);
          mb.v += (mb.v - p.v) / (d || 1) * Math.max(0, 0.75 - d);
        }
      }
    }
  }
  sprites(ctx: HazardContext, out: Sprite[]): void {
    const frames = [...FRAMES.riser].sort((a, b) => a.h - b.h);
    for (const p of this.pistons) {
      if (p.rise <= 0.02) continue;
      const idx = Math.min(frames.length - 1, Math.floor(p.rise * frames.length));
      out.push({ img: ctx.assets.sheets.riser, frame: frames[idx], u: p.u, v: p.v, z: this.z, dy: 3, depthBias: 2 });
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Wave plate: a hump travels along the plate and carries the marble with it */
/* (review clip: intermediate_level_waves).                                 */
/* ------------------------------------------------------------------------ */
export class WavePlate extends Hazard {
  t = 0;
  reset(ctx: HazardContext): void { const top = topAt(ctx.level, this.spawn.u, this.spawn.v); this.z = top ? top.z : 0; this.t = 0; }
  /** hump centre along u for the current time */
  humpU(): number {
    const r = this.spawn.rect!; const period = this.spawn.period ?? 2.6;
    const c = (this.t % period) / period;
    return r.u0 - 1.5 + c * (r.u1 - r.u0 + 3);
  }
  update(dt: number, ctx: HazardContext): void {
    this.t += dt;
    const r = this.spawn.rect; if (!r) return;
    const hu = this.humpU();
    for (const mb of ctx.marbles) {
      if (mb.phase !== 'alive' || mb.inPipe || !mb.grounded) continue;
      if (mb.v < r.v0 || mb.v > r.v1 || Math.abs(mb.z - this.z) > 14) continue;
      const d = mb.u - hu;
      if (Math.abs(d) < 1.6) {
        // ride the hump: push forward, stronger on the front slope
        mb.impU += (d < 0 ? 5.5 : 2.5) * dt;
        if (Math.abs(d) < 0.6 && mb.vz <= 0 && mb.grounded && ctx.rng() < dt * 4) { mb.grounded = false; mb.vz = 60; mb.maxZ = mb.z; mb.airT = 0; }
      }
    }
  }
  sprites(): void { /* drawn as an overlay */ }
  drawOverlay(ctx2d: CanvasRenderingContext2D, project: Project): void {
    const r = this.spawn.rect; if (!r) return;
    const hu = this.humpU();
    const u0 = Math.max(r.u0, hu - 1.6), u1 = Math.min(r.u1, hu + 1.6);
    if (u1 <= u0) return;
    const H = 9; // hump height in px
    const p = (u: number, v: number, dz: number) => project(u, v, this.z + dz);
    // lit front slope
    ctx2d.fillStyle = 'rgba(120,190,80,0.95)';
    ctx2d.beginPath();
    let a = p(u0, r.v0, 0), b = p(hu, r.v0, H), c = p(hu, r.v1, H), d = p(u0, r.v1, 0);
    ctx2d.moveTo(a.x, a.y); ctx2d.lineTo(b.x, b.y); ctx2d.lineTo(c.x, c.y); ctx2d.lineTo(d.x, d.y); ctx2d.closePath(); ctx2d.fill();
    // shaded back slope
    ctx2d.fillStyle = 'rgba(40,90,40,0.95)';
    ctx2d.beginPath();
    a = p(hu, r.v0, H); b = p(u1, r.v0, 0); c = p(u1, r.v1, 0); d = p(hu, r.v1, H);
    ctx2d.moveTo(a.x, a.y); ctx2d.lineTo(b.x, b.y); ctx2d.lineTo(c.x, c.y); ctx2d.lineTo(d.x, d.y); ctx2d.closePath(); ctx2d.fill();
    // crest line
    ctx2d.strokeStyle = 'rgba(200,240,160,0.9)'; ctx2d.lineWidth = 1;
    a = p(hu, r.v0, H); b = p(hu, r.v1, H);
    ctx2d.beginPath(); ctx2d.moveTo(a.x, a.y); ctx2d.lineTo(b.x, b.y); ctx2d.stroke();
  }
}

/* ------------------------------------------------------------------------ */
/* Birds: flock does fast fly-bys; occasionally zaps the marble              */
/* ------------------------------------------------------------------------ */
interface BirdUnit { x: number; y: number; vx: number; vy: number; phase: number }
export class Birds extends Hazard {
  units: BirdUnit[] = [];
  t = 0;
  next = 0;
  zapT = 0;
  zapAt: { u: number; v: number; z: number } | null = null;
  reset(ctx: HazardContext): void { this.units = []; this.next = 2 + ctx.rng() * 3; this.zapAt = null; }
  update(dt: number, ctx: HazardContext): void {
    this.t += dt;
    const target = ctx.local;
    const band = this.spawn.band;
    const inBand = !band || (target.u + target.v >= band[0] && target.u + target.v <= band[1]);
    this.next -= dt;
    if (this.next <= 0 && inBand && target.phase === 'alive') {
      const n = this.spawn.count ?? 4;
      const fromLeft = ctx.rng() < 0.5;
      const sx = (target.u - target.v) * 8, sy = (target.u + target.v) * 4 - target.z;
      for (let i = 0; i < n; i++) {
        const x = sx + (fromLeft ? -170 : 170) - i * (fromLeft ? 28 : -28) + (ctx.rng() - 0.5) * 16;
        const y = sy - 30 + (ctx.rng() - 0.5) * 60;
        const vx = (fromLeft ? 1 : -1) * (150 + ctx.rng() * 60);
        const vy = ((sy - y) / 1.6) + (ctx.rng() - 0.5) * 30;
        this.units.push({ x, y, vx, vy, phase: ctx.rng() * 10 });
      }
      this.next = (this.spawn.period ?? 7) * (0.7 + ctx.rng() * 0.8);
    }
    if (this.zapT > 0) this.zapT -= dt;
    for (const b of this.units) {
      b.x += b.vx * dt; b.y += b.vy * dt;
      const sx = (target.u - target.v) * 8, sy = (target.u + target.v) * 4 - target.z - 6;
      if (target.phase === 'alive' && !target.inPipe && Math.abs(b.x - sx) < 7 && Math.abs(b.y - sy) < 9 && ctx.rng() < 0.35) {
        this.zapT = 0.5; this.zapAt = { u: target.u, v: target.v, z: target.z };
        ctx.onEvent({ type: 'bird-zap', marble: target });
      }
    }
    this.units = this.units.filter((b) => Math.abs(b.x - (target.u - target.v) * 8) < 420 && Math.abs(b.y - ((target.u + target.v) * 4)) < 400);
  }
  sprites(ctx: HazardContext, out: Sprite[]): void {
    const frames = FRAMES.bird;
    for (const b of this.units) {
      const f = frames[2 + (Math.floor((this.t + b.phase) * 10) % 2)];
      const S = b.y / 4, D = b.x / 8;
      out.push({ img: ctx.assets.sheets.bird, frame: f, u: (S + D) / 2, v: (S - D) / 2, z: 0, flip: b.vx < 0, depthBias: 500 });
    }
    if (this.zapT > 0 && this.zapAt) {
      const f = frames[this.zapT > 0.25 ? 0 : 1];
      out.push({ img: ctx.assets.sheets.bird, frame: f, u: this.zapAt.u, v: this.zapAt.v, z: this.zapAt.z, dy: -8, depthBias: 600 });
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Wand: appears at random, freezes the marble, grants time                 */
/* ------------------------------------------------------------------------ */
export class Wand extends Hazard {
  next = 0;
  active = 0;
  target: Marble | null = null;
  granted = false;
  reset(ctx: HazardContext): void { this.next = 6 + ctx.rng() * 10; this.active = 0; this.target = null; }
  update(dt: number, ctx: HazardContext): void {
    if (this.active > 0 && this.target) {
      this.active -= dt;
      this.target.frozenT = Math.max(this.target.frozenT, 0.05);
      if (this.active <= 0) {
        this.target.frozenT = 0;
        if (!this.granted) { this.granted = true; ctx.onEvent({ type: 'wand', marble: this.target }); }
        this.target = null;
        this.next = 12 + ctx.rng() * 14;
      }
      return;
    }
    const band = this.spawn.band;
    const m = ctx.local;
    const inBand = !band || (m.u + m.v >= band[0] && m.u + m.v <= band[1]);
    this.next -= dt;
    if (this.next <= 0 && inBand && m.phase === 'alive' && m.grounded && !m.inPipe) {
      this.active = WAND_FREEZE; this.target = m; this.granted = false;
      m.frozenT = WAND_FREEZE;
      ctx.onEvent({ type: 'sfx', name: 'item' });
    }
  }
  sprites(ctx: HazardContext, out: Sprite[]): void {
    if (this.active > 0 && this.target) {
      const f = FRAMES.marble.sparkle[0];
      const bob = Math.sin(this.active * 18) * 2;
      out.push({ img: ctx.assets.sheets.marble, frame: f, u: this.target.u, v: this.target.v, z: this.target.z, dy: -18 + bob, depthBias: 600 });
    }
  }
}

export function makeHazard(h: HazardSpawn): Hazard {
  switch (h.kind) {
    case 'steelie': return new Steelie(h);
    case 'worm': return new Worm(h);
    case 'slime': return new Slime(h);
    case 'hammer': return new Hammer(h);
    case 'vacuum': return new Vacuum(h);
    case 'birds': return new Birds(h);
    case 'wand': return new Wand(h);
    case 'risers': return new Risers(h);
    case 'wave': return new WavePlate(h);
  }
}
