import { StageDef, HazardSpawn, topAt, supportAt } from '../engine/level';
import { Marble, MarbleEvent } from '../engine/physics';
import { Sprite } from '../render/renderer';
import { Assets, FRAMES } from '../engine/assets';
import { WAND_FREEZE, MARBLE_R } from '../engine/constants';

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

export abstract class Hazard {
  u: number; v: number; z = 0;
  constructor(public spawn: HazardSpawn) { this.u = spawn.u; this.v = spawn.v; }
  abstract update(dt: number, ctx: HazardContext): void;
  abstract sprites(ctx: HazardContext, out: Sprite[]): void;
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

  constructor(spawn: HazardSpawn) {
    super(spawn);
  }

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
    // chase when within ~14 tiles and roughly same height, else wander
    let ax = 0, ay = 0;
    const d = dist(b, target);
    if (target.phase === 'alive' && d < 14 && Math.abs(target.z - b.z) < 30) {
      const dx = target.u - b.u, dy = target.v - b.v;
      // convert world direction to screen dir for the shared physics input
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
    if (b.phase !== 'alive') {
      // fell off / shattered: come back after a while
      this.active = false; this.respawnT = 3;
      return;
    }
    // collide with marbles
    for (const m of ctx.marbles) {
      if (m.phase !== 'alive' || m.inPipe) continue;
      const before = m.speed;
      if (m.collideBall(b.u, b.v, b.z, b.vu, b.vv, 2.2, MARBLE_R * 2)) {
        // steelie recoils a little
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
const WORM_WALK = [0, 2, 4, 5, 9, 10, 13, 16, 20, 22, 24]; // body poses approximating the flip cycle
const WORM_EAT = [7, 8, 12, 8, 7];                          // mouth up / open / looking down the throat

export class Worm extends Hazard {
  t = 0;
  dirU = 1; dirV = 0;
  eating = 0;
  stunned = 0;
  hop = 0;

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
    // pick direction: toward marble if near, else drift back toward home
    let tu: number, tv: number;
    if (target.phase === 'alive' && d < 9 && Math.abs(target.z - this.z) < 12) { tu = target.u; tv = target.v; }
    else { tu = this.spawn.u + Math.sin(this.t * 0.5) * range * 0.6; tv = this.spawn.v + Math.cos(this.t * 0.37) * range * 0.6; }
    const dx = tu - this.u, dy = tv - this.v; const m = Math.hypot(dx, dy) || 1;
    if (m > 0.3) { this.dirU = dx / m; this.dirV = dy / m; }
    const speed = this.stunned > 0 ? 0 : 2.1;
    // slinky: moves in pulses
    const pulse = Math.max(0, Math.sin(this.t * 4.5));
    const nu = this.u + this.dirU * speed * pulse * dt * 1.6;
    const nv = this.v + this.dirV * speed * pulse * dt * 1.6;
    const sup = supportAt(ctx.level, nu, nv, this.z + 4, 6);
    if (sup && Math.abs(sup.z - this.z) < 6 && dist({ u: nu, v: nv }, this.spawn) < range + 1) { this.u = nu; this.v = nv; this.z = sup.z; }
    else { this.dirU = -this.dirU; this.dirV = -this.dirV; }
    // interactions
    for (const mb of ctx.marbles) {
      if (mb.phase !== 'alive' || mb.inPipe) continue;
      const dd = dist(this, mb);
      if (dd < 1.0 && Math.abs(mb.z - this.z) < 10) {
        if (mb.speed > 7 && this.stunned <= 0) {
          // bumped hard: knocked back and stunned
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
    let f;
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
/* Slime / acid puddle: stays put, wanders a few tiles, stuns the marble    */
/* ------------------------------------------------------------------------ */
export class Slime extends Hazard {
  t = 0;
  phase = 0;
  cool = 0;
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
    if (this.cool > 0) this.cool -= dt;
    for (const mb of ctx.marbles) {
      if (mb.phase !== 'alive' || mb.inPipe || !mb.grounded) continue;
      if (dist(this, mb) < 1.0 && Math.abs(mb.z - this.z) < 8 && this.cool <= 0 && mb.dizzyT <= 0) {
        mb.dizzyT = 1.4;
        mb.vu *= 0.5; mb.vv *= 0.5;
        this.cool = 1.5;
        ctx.onEvent({ type: 'sfx', name: 'fall', vol: 0.6 });
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
/* Hammer: fixed spot, pounds periodically                                  */
/* ------------------------------------------------------------------------ */
export class Hammer extends Hazard {
  t = 0;
  reset(ctx: HazardContext): void {
    const top = topAt(ctx.level, this.spawn.u, this.spawn.v); this.z = top ? top.z : 0;
    this.t = this.spawn.phase ?? 0;
  }
  /** 0..1 within the pound cycle */
  cycle(): number { const p = this.spawn.period ?? 2.2; return (this.t % p) / p; }
  headDown(): boolean { const c = this.cycle(); return c > 0.62 && c < 0.8; }
  update(dt: number, ctx: HazardContext): void {
    this.t += dt;
    if (!this.headDown()) return;
    for (const mb of ctx.marbles) {
      if (mb.phase !== 'alive' || mb.inPipe) continue;
      if (dist(this, mb) < 1.1 && Math.abs(mb.z - this.z) < 10) {
        mb.die('crush');
        ctx.onEvent({ type: 'sfx', name: 'shatter' });
      }
    }
  }
  sprites(ctx: HazardContext, out: Sprite[]): void {
    const frames = FRAMES.hammer;
    const c = this.cycle();
    // raise slowly (frames 0..3), fall fast (4..7), rest down
    let idx: number;
    if (c < 0.6) idx = Math.min(3, Math.floor(c / 0.6 * 4));
    else if (c < 0.7) idx = 4 + Math.min(3, Math.floor((c - 0.6) / 0.1 * 4));
    else idx = 7;
    const f = frames[idx];
    out.push({ img: ctx.assets.sheets.hammer, frame: f, u: this.u, v: this.v, z: this.z, dy: 2, flip: this.spawn.facing === -1, depthBias: 3 });
  }
}

/* ------------------------------------------------------------------------ */
/* Vacuum: fixed spot, rises periodically and sucks the marble in           */
/* ------------------------------------------------------------------------ */
export class Vacuum extends Hazard {
  t = 0;
  victim: Marble | null = null;
  reset(ctx: HazardContext): void {
    const top = topAt(ctx.level, this.spawn.u, this.spawn.v); this.z = top ? top.z : 0;
    this.t = this.spawn.phase ?? 0; this.victim = null;
  }
  /** 0..1 raised amount */
  raised(): number {
    const p = this.spawn.period ?? 5;
    const c = (this.t % p) / p;
    if (c < 0.25) return c / 0.25;          // rising
    if (c < 0.6) return 1;                  // up
    if (c < 0.75) return 1 - (c - 0.6) / 0.15; // lowering
    return 0;                               // hidden
  }
  update(dt: number, ctx: HazardContext): void {
    this.t += dt;
    const r = this.raised();
    if (r < 0.9) return;
    for (const mb of ctx.marbles) {
      if (mb.phase !== 'alive' || mb.inPipe) continue;
      const d = dist(this, mb);
      if (d < 3.2 && Math.abs(mb.z - this.z) < 12) {
        // suction toward the nozzle
        const k = (1 - d / 3.2) * 26 * dt;
        mb.impU += (this.u - mb.u) / (d || 1) * k; mb.impV += (this.v - mb.v) / (d || 1) * k;
        if (d < 0.9) {
          mb.squeezeDir = (mb.u - mb.v) < (this.u - this.v) ? 1 : -1;
          mb.die('squeeze');
          ctx.onEvent({ type: 'sfx', name: 'springboard' });
        }
      }
    }
  }
  sprites(ctx: HazardContext, out: Sprite[]): void {
    const frames = FRAMES.vacuum;
    const r = this.raised();
    if (r <= 0.01) return;
    const idx = Math.min(frames.length - 1, Math.floor(r * (frames.length - 1)));
    out.push({ img: ctx.assets.sheets.vacuum, frame: frames[idx], u: this.u, v: this.v, z: this.z, dy: 4, flip: this.spawn.facing === -1, depthBias: 3 });
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
      // launch a flock across the marble in screen space
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
      // zap check (screen-space proximity to the marble)
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
      // convert screen (map) coordinates back to a world point with z=0 for sorting
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
  }
}
