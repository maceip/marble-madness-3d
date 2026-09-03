import { StageDef, Slide, supportAt, highestBelow, Support, gradientOn, inRect, heightOn } from './level';
import { screenDirToWorld } from './iso';
import {
  ACCEL, FRICTION, MAX_SPEED, SLOPE_K, GRAVITY, STEP_UP, DROP_SNAP, BOUNCE, BOUNCE_SFX_SPEED,
  DIZZY_FALL, SHATTER_FALL, DIZZY_TIME, VOID_FALL_TIME, MARBLE_R, DEATH_ANIM,
} from './constants';

export type DeathKind = keyof typeof DEATH_ANIM;
export type MarblePhase = 'alive' | 'dying' | 'dead' | 'hidden';

export interface MarbleInput {
  /** screen-space steering, magnitude 0..1 */
  ax: number; ay: number;
}

export interface MarbleEvent {
  type: 'bounce' | 'land' | 'dizzy' | 'die' | 'airborne';
  speed?: number;
  fall?: number;
  kind?: DeathKind;
}

export class Marble {
  u = 0; v = 0; z = 0;
  vu = 0; vv = 0; vz = 0;
  grounded = true;
  phase: MarblePhase = 'alive';
  deathKind: DeathKind = 'shatter';
  deathT = 0;
  dizzyT = 0;
  frozenT = 0;
  airT = 0;
  maxZ = 0;
  rollDist = 0;
  /** last surface stood on */
  support: Support | null = null;
  /** external velocity impulse accumulated this frame (bumps) */
  impU = 0; impV = 0;
  /** debug: last surface that blocked movement */
  lastBlock = '';
  /** squeeze direction for the suck/eat animation */
  squeezeDir: 1 | -1 = 1;
  /** true while inside a pipe (invisible, uncontrollable) */
  inPipe = false;
  pipeT = 0;
  cornerTrip = false;
  pipeExit: { u: number; v: number; z?: number; vu: number; vv: number } | null = null;
  /** scripted roll (see Slide): no control, cannot fall off */
  slide: { pts: { u: number; v: number; z: number }[]; seg: number; s: number; speed: number; delay: number } | null = null;

  beginSlide(sl: Slide): void {
    if (sl.pts.length < 2) return;
    const p = sl.pts[0];
    this.u = p.u; this.v = p.v; this.z = p.z; this.vu = this.vv = this.vz = 0; this.grounded = true;
    this.slide = { pts: sl.pts, seg: 0, s: 0, speed: 0, delay: sl.delay };
  }

  private stepSlide(level: StageDef, dt: number, events: MarbleEvent[]): void {
    const sl = this.slide!;
    if (sl.delay > 0) { sl.delay -= dt; return; }
    sl.speed = Math.min(22, sl.speed + 14 * dt);
    let ds = sl.speed * dt;
    while (ds > 0) {
      const a = sl.pts[sl.seg], b = sl.pts[sl.seg + 1];
      const len = Math.hypot(b.u - a.u, b.v - a.v) || 1e-6;
      const left = len - sl.s;
      if (ds < left) {
        sl.s += ds; ds = 0;
        const k = sl.s / len;
        this.u = a.u + (b.u - a.u) * k; this.v = a.v + (b.v - a.v) * k; this.z = a.z + (b.z - a.z) * k;
        this.vu = (b.u - a.u) / len * sl.speed; this.vv = (b.v - a.v) / len * sl.speed;
        this.rollDist += sl.speed * dt;
      } else {
        ds -= left; sl.seg++; sl.s = 0;
        if (sl.seg >= sl.pts.length - 1) {
          // landed: stand on the platform, spin, and hand control to the player
          const e = sl.pts[sl.pts.length - 1];
          this.u = e.u; this.v = e.v; this.z = e.z;
          const sup = supportAt(level, e.u, e.v, e.z + 6, 12);
          if (sup) { this.z = sup.z; this.support = sup; }
          this.vu = this.vv = this.vz = 0; this.grounded = true; this.maxZ = this.z; this.airT = 0;
          this.dizzyT = DIZZY_TIME;
          this.slide = null;
          events.push({ type: 'land', fall: 20 });
          events.push({ type: 'dizzy' });
          return;
        }
      }
    }
  }

  get speed(): number { return Math.hypot(this.vu, this.vv); }

  place(u: number, v: number, z: number): void {
    this.u = u; this.v = v; this.z = z;
    this.vu = this.vv = this.vz = 0;
    this.grounded = true; this.phase = 'alive'; this.deathT = 0; this.dizzyT = 0; this.frozenT = 0;
    this.airT = 0; this.maxZ = z; this.inPipe = false; this.pipeExit = null;
  }

  die(kind: DeathKind, events?: MarbleEvent[]): void {
    if (this.phase !== 'alive') return;
    this.phase = 'dying';
    this.deathKind = kind;
    this.deathT = 0;
    this.vu = this.vv = this.vz = 0;
    events?.push({ type: 'die', kind });
  }

  /**
   * Advance the marble. `dt` is split into ≤ 1/120 s substeps.
   */
  step(level: StageDef, input: MarbleInput, dt: number, events: MarbleEvent[]): void {
    if (this.phase === 'dying') {
      this.deathT += dt;
      if (this.deathT >= DEATH_ANIM[this.deathKind]) this.phase = 'dead';
      return;
    }
    if (this.phase !== 'alive') return;

    if (this.slide) { this.stepSlide(level, dt, events); return; }

    if (this.inPipe) {
      this.pipeT -= dt;
      if (this.pipeT <= 0 && this.pipeExit) {
        const e = this.pipeExit;
        const sup = e.z !== undefined ? supportAt(level, e.u, e.v, e.z + 12, 0) : supportAt(level, e.u, e.v, 1e9, 0);
        this.u = e.u; this.v = e.v; this.z = sup ? sup.z : (e.z ?? this.z);
        this.support = sup;
        this.vu = e.vu; this.vv = e.vv; this.vz = 0;
        this.inPipe = false; this.pipeExit = null; this.grounded = true; this.maxZ = this.z;
      }
      return;
    }

    if (this.dizzyT > 0) this.dizzyT = Math.max(0, this.dizzyT - dt);
    if (this.frozenT > 0) {
      this.frozenT = Math.max(0, this.frozenT - dt);
      this.vu = this.vv = 0;
      return;
    }

    let remaining = dt;
    while (remaining > 1e-6) {
      const h = Math.min(remaining, 1 / 120);
      remaining -= h;
      this.substep(level, input, h, events);
    }
  }

  private substep(level: StageDef, input: MarbleInput, h: number, events: MarbleEvent[]): void {
    // --- acceleration -----------------------------------------------------
    let ax = input.ax, ay = input.ay;
    if (this.dizzyT > 0) {
      // wobbly, weakened control while stunned
      const wob = Math.sin(this.dizzyT * 22) * 0.6;
      const mag = Math.hypot(ax, ay);
      const ang = Math.atan2(ay, ax) + wob;
      ax = Math.cos(ang) * mag * 0.45; ay = Math.sin(ang) * mag * 0.45;
    }
    const dir = screenDirToWorld(ax, ay);
    let au = 0, av = 0;
    if (this.grounded) {
      const isIce = !!this.support?.s.name?.toLowerCase().includes('ice');
      const accelK = isIce ? 0.35 : 1.0;
      au += dir.du * ACCEL * accelK;
      av += dir.dv * ACCEL * accelK;
      if (this.support) {
        const g = gradientOn(this.support.s, this.u, this.v);
        au -= g.gu * SLOPE_K;   // gravity pulls toward lower z
        av -= g.gv * SLOPE_K;
      }
    } else {
      // slight air control, like the arcade
      au += dir.du * ACCEL * 0.25;
      av += dir.dv * ACCEL * 0.25;
    }
    au += this.impU / h; av += this.impV / h;
    this.impU = this.impV = 0;

    this.vu += au * h;
    this.vv += av * h;
    if (this.grounded) {
      const isIce = this.support?.s.kind === 'ice' || !!this.support?.s.name?.toLowerCase().includes('ice');
      const isGrate = this.support?.s.kind === 'grate' || !!this.support?.s.name?.toLowerCase().includes('grate');
      let frict = isIce ? 0.25 : FRICTION;
      if (isGrate) frict = FRICTION * 1.35; // corrugated ridges drag
      const f = Math.exp(-frict * h);
      this.vu *= f; this.vv *= f;
    }
    const sp = this.speed;
    if (sp > MAX_SPEED) { this.vu *= MAX_SPEED / sp; this.vv *= MAX_SPEED / sp; }

    // --- horizontal move with wall resolution ------------------------------
    const nu = this.u + this.vu * h;
    const nv = this.v + this.vv * h;
    const zRef = this.z;
    const moved = this.tryMove(level, nu, nv, zRef, events);

    // --- vertical: support / falling --------------------------------------
    const sup = supportAt(level, this.u, this.v, zRef, this.grounded ? STEP_UP : 0.01, this.grounded ? this.support?.s : null);
    if (this.grounded) {
      if (sup && this.z - sup.z <= DROP_SNAP) {
        // follow the floor (ramps, small steps)
        if (sup.z > this.z) this.z = sup.z; else this.z = sup.z;
        this.support = sup;
        this.maxZ = this.z;
      } else {
        // left an edge: become airborne
        this.grounded = false;
        this.airT = 0;
        // corner crossing dizzy check (cornerequalsdizzy.png)
        if (this.support) {
          const s = this.support.s;
          const uNear = Math.abs(this.u - s.u0) <= 1.5 || Math.abs(this.u - s.u1) <= 1.5;
          const vNear = Math.abs(this.v - s.v0) <= 1.5 || Math.abs(this.v - s.v1) <= 1.5;
          if (uNear && vNear) this.cornerTrip = true;
        }
        // vertical launch from ramps: dz/dt = gu*vu + gv*vv
        const gr = this.support ? gradientOn(this.support.s, this.u, this.v) : { gu: 0, gv: 0 };
        const g = gr.gu * this.vu + gr.gv * this.vv;
        this.vz = Math.max(-40, Math.min(160, g));
        this.maxZ = this.z;
        events.push({ type: 'airborne' });
      }
    } else {
      this.vz -= GRAVITY * h;
      this.z += this.vz * h;
      this.airT += h;
      this.maxZ = Math.max(this.maxZ, this.z);
      const floor = sup;
      if (floor && this.z <= floor.z) {
        // landing
        this.z = floor.z;
        this.grounded = true;
        this.support = floor;
        const fall = this.maxZ - this.z;
        this.vz = 0;
        this.vu *= 0.85; this.vv *= 0.85;
        if (fall > SHATTER_FALL) {
          this.die('shatter', events);
          events.push({ type: 'land', fall });
          return;
        }
        if (fall > DIZZY_FALL || this.cornerTrip) {
          this.dizzyT = DIZZY_TIME;
          events.push({ type: 'dizzy', fall });
          this.cornerTrip = false;
        }
        events.push({ type: 'land', fall, speed: this.speed });
      } else if (!floor && (this.airT > VOID_FALL_TIME || this.z < level.floorMin - 60)) {
        this.die('void', events);
        return;
      }
    }

    if (moved) this.rollDist += this.speed * h;
  }

  /** Move toward (nu,nv) resolving wall faces axis by axis. Returns true if the marble moved. */
  private tryMove(level: StageDef, nu: number, nv: number, zRef: number, events: MarbleEvent[]): boolean {
    // surfaces already claiming the marble's current spot above it are overlap artifacts / overpasses, not walls;
    // the surface we stand on can never block us (steep ramps probe higher up-slope)
    const here = new Set<number>();
    if (this.support) here.add(this.support.s.id);
    for (const s of level.surfaces) {
      if (s.kind === 'wall') continue;
      if (inRect(s, this.u, this.v) && heightOn(s, this.u, this.v) > zRef + STEP_UP) here.add(s.id);
    }
    const blocked = (u: number, v: number): boolean => {
      // probe centre and leading edge
      const dx = u - this.u, dy = v - this.v;
      const m = Math.hypot(dx, dy) || 1;
      const pu = u + (dx / m) * MARBLE_R, pv = v + (dy / m) * MARBLE_R;
      for (const [qu, qv] of [[u, v], [pu, pv]] as const) {
        const hb = highestBelow(level, qu, qv, zRef, undefined, here);
        if (hb && hb.z > zRef + STEP_UP) { this.lastBlock = `${hb.s.name ?? hb.s.id}@${hb.z.toFixed(1)} at ${qu.toFixed(2)},${qv.toFixed(2)} z${zRef.toFixed(1)}`; return true; }
      }
      return false;
    };
    if (!blocked(nu, nv)) { this.u = nu; this.v = nv; return true; }
    const sp = this.speed;
    if (!blocked(nu, this.v)) {
      this.u = nu; this.vv = -this.vv * BOUNCE; this.bounceEvt(sp, events); return true;
    }
    if (!blocked(this.u, nv)) {
      this.v = nv; this.vu = -this.vu * BOUNCE; this.bounceEvt(sp, events); return true;
    }
    this.vu = -this.vu * BOUNCE; this.vv = -this.vv * BOUNCE; this.bounceEvt(sp, events);
    return false;
  }

  private bounceEvt(speed: number, events: MarbleEvent[]): void {
    if (speed > BOUNCE_SFX_SPEED) events.push({ type: 'bounce', speed });
  }

  /** Elastic-ish collision with another ball (steelie or remote marble). */
  collideBall(ou: number, ov: number, oz: number, ovu: number, ovv: number, otherMass: number, radius: number): boolean {
    if (Math.abs(oz - this.z) > 10) return false;
    const dx = this.u - ou, dy = this.v - ov;
    const d = Math.hypot(dx, dy);
    if (d >= radius || d < 1e-6) return false;
    const nx = dx / d, ny = dy / d;
    // separate
    const overlap = radius - d;
    this.u += nx * overlap * 0.6; this.v += ny * overlap * 0.6;
    // relative velocity along normal
    const rv = (this.vu - ovu) * nx + (this.vv - ovv) * ny;
    if (rv < 0) {
      const m1 = 1, m2 = otherMass;
      const j = -(1 + 0.8) * rv / (1 / m1 + 1 / m2);
      this.vu += (j / m1) * nx; this.vv += (j / m1) * ny;
    }
    return true;
  }
}
