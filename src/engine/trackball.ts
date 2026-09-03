/**
 * Physical Arcade Trackball Simulation.
 * Models a heavy phenolic/polycarbonate ball on steel bearing rollers:
 * - 3D rotation matrix tracking true pitch, yaw, and roll.
 * - Static friction (stiction / breakout pushback).
 * - Bearing friction (exponential momentum decay).
 * - Multi-swipe pumping (compounding angular velocity).
 * - Counter-spinning (arcade-style braking).
 * - Web Haptics (breakout click, bearing encoder ratchet ticks, counter-brake buzz).
 */

export interface TrackballOptions {
  radius?: number;          // virtual touch radius in px (default 70)
  friction?: number;        // bearing friction coefficient (default 3.2)
  maxOmega?: number;        // maximum angular velocity in rad/s (default 32)
  inertia?: number;         // heavy ball rotational mass / inertia (default 3.8)
  stictionPx?: number;      // drag px needed to break static friction (default 14)
  hapticStepRad?: number;   // radians per encoder ratchet tick (default 0.35 rad ~ 20 deg)
  enableHaptics?: boolean;  // whether haptics are enabled
}

export class Trackball {
  // 3x3 rotation matrix in column-major order (standard for WebGL: mat3)
  rot: Float32Array = new Float32Array([
    1, 0, 0,
    0, 1, 0,
    0, 0, 1,
  ]);

  // Angular velocity around X (pitch) and Y (yaw) in rad/s
  // omegaX > 0 rolls the ball downwards; omegaY > 0 rolls the ball rightwards
  wx = 0;
  wy = 0;

  // Configuration
  radius: number;
  friction: number;
  maxOmega: number;
  inertia: number;
  stictionPx: number;
  hapticStepRad: number;
  enableHaptics = true;

  // Stiction state
  private dragAccumPx = 0;
  private brokenOut = false;
  private dragging = false;

  // Haptics timing & ratchet
  private hapticAccumRad = 0;
  private lastHapticTime = 0;

  /** Android host: the native engine (tbDown/tbRoll/tbBreakout/tbBrake/tbUp) drives the actuator from these
   *  physical events, on the input path, with angle-based bearing ticks; the JS ratchet below is the web fallback */
  private get engine(): { tbDown(o: number): void; tbRoll(a: number, o: number): void; tbBreakout(): void; tbBrake(o: number): void; tbUp(): void } | null {
    if (!this.enableHaptics) return null;
    const nb = (window as unknown as { NativeBridge?: { tbRoll?: unknown } }).NativeBridge;
    return nb && typeof nb.tbRoll === 'function' ? (nb as never) : null;
  }

  constructor(opts: TrackballOptions = {}) {
    this.radius = opts.radius ?? 70;
    this.friction = opts.friction ?? 3.2;
    this.maxOmega = opts.maxOmega ?? 32;
    this.inertia = opts.inertia ?? 3.8;
    this.stictionPx = opts.stictionPx ?? 14;
    this.hapticStepRad = opts.hapticStepRad ?? 0.35;
    if (opts.enableHaptics !== undefined) this.enableHaptics = opts.enableHaptics;
  }

  /**
   * Called when touch/mouse drag begins.
   */
  startDrag(): void {
    this.dragging = true;
    this.dragAccumPx = 0;
    // If ball is already spinning fast, breakout is already broken
    this.brokenOut = Math.hypot(this.wx, this.wy) > 1.5;
    try { this.engine?.tbDown(Math.hypot(this.wx, this.wy)); } catch { /* bridge gone */ }
  }

  /**
   * Called on each touch/mouse move delta (in screen pixels).
   * dx > 0 = right, dy > 0 = down screen.
   */
  dragDelta(dx: number, dy: number, dt = 0.016): void {
    const dist = Math.hypot(dx, dy);
    if (dist < 0.2) return;

    if (!this.brokenOut) {
      this.dragAccumPx += dist;
      if (this.dragAccumPx >= this.stictionPx) {
        this.brokenOut = true;
        const eng = this.engine;
        if (eng) { try { eng.tbBreakout(); } catch { /* bridge gone */ } } else this.vibrate(8); // Crisp breakout click
      } else {
        // Still resisting: slight elastic nudge
        return;
      }
    }

    // Convert pixel delta to angular impulse (rad/s) with heavy ball rotational mass
    const impulseK = 0.12 / (1.0 + this.inertia * 0.35);
    const targetWx = (dy / this.radius) / Math.max(0.016, dt) * impulseK;
    const targetWy = (dx / this.radius) / Math.max(0.016, dt) * impulseK;

    // Check for counter-spinning (braking against current spin)
    const dot = this.wx * targetWx + this.wy * targetWy;
    const currentSpeed = Math.hypot(this.wx, this.wy);
    const targetSpeed = Math.hypot(targetWx, targetWy);

    const eng = this.engine;
    if (currentSpeed > 2.5 && targetSpeed > 1.2 && dot < -0.25 * currentSpeed * targetSpeed) {
      // Counter-braking! Palm on the heavy ball absorbs momentum
      this.wx *= 0.55;
      this.wy *= 0.55;
      if (eng) { try { eng.tbBrake(currentSpeed); } catch { /* bridge gone */ } } else this.vibrate([8, 12, 8]);
    } else {
      // Pumping: steady spin-up against heavy ball inertia
      const accelDamp = 0.18 / (1.0 + this.inertia * 0.25);
      this.wx += targetWx * accelDamp;
      this.wy += targetWy * accelDamp;
      if (eng) { try { eng.tbRoll(dist / this.radius, Math.hypot(this.wx, this.wy)); } catch { /* bridge gone */ } }
    }

    this.clampVelocity();
  }

  /**
   * Called when touch/mouse drag ends. Momentum carries forward.
   */
  endDrag(): void {
    this.dragging = false;
    this.brokenOut = false;
    try { this.engine?.tbUp(); } catch { /* bridge gone */ }   // silence at once: the ball is now free of the hand
  }

  /**
   * Direct programmatic spin (used by WebMCP AI agent and keyboard torque).
   * dx: -1..1, dy: -1..1, speed: 1..100 (relative intensity).
   */
  spin(dx: number, dy: number, speed: number): void {
    const norm = Math.hypot(dx, dy) || 1;
    const s = Math.max(0.1, Math.min(100, speed));
    // Heavy ball inertia scales the impulse down so a single pulse does not snap to max speed
    const radDelta = (s / 100) * (this.maxOmega / (1.0 + this.inertia * 2.8));
    
    // Check counter-spin
    const curSpeed = Math.hypot(this.wx, this.wy);
    const dot = (this.wy * dx + this.wx * dy) / norm;
    if (curSpeed > 2.5 && dot < -0.25 * curSpeed) {
      this.wx *= 0.55;
      this.wy *= 0.55;
      this.vibrate([8, 12, 8]);
    }

    this.wy += (dx / norm) * radDelta;
    this.wx += (dy / norm) * radDelta;
    this.clampVelocity();
  }

  /**
   * Update physics step: integrate rotation matrix, decay velocity, update haptics.
   */
  update(dt: number): void {
    if (dt <= 0) return;

    const speed = Math.hypot(this.wx, this.wy);
    if (speed > 1e-4) {
      const angle = speed * dt;
      // Axis of rotation:
      // wx (pitch around screen X) rolls down/up -> vector (1, 0, 0)
      // wy (yaw around screen Y) rolls right/left -> vector (0, 1, 0)
      // Screen space: rolling down (+dy) means rotation axis is (+1, 0, 0)
      // Rolling right (+dx) means rotation axis is (0, -1, 0)
      const ax = this.wx / speed;
      const ay = -this.wy / speed;
      const az = 0;

      this.rotateAroundAxis(ax, ay, az, angle);

      // Distance-threshold haptic ticks (Low Speed Only: under 3.5 rad/s):
      // Enforces at most once every 75ms past a fixed arc to prevent Android motor washout
      const now = performance.now();
      if (this.dragging && speed > 0.4 && speed < 3.5 && !this.engine) {   // web fallback ratchet only
        this.hapticAccumRad += angle;
        if (this.hapticAccumRad > 0.45 && now - this.lastHapticTime > 75) {
          this.vibrate(2); // Shortest possible tick
          this.hapticAccumRad = 0;
        }
      } else {
        this.hapticAccumRad = 0;
      }

      // Dynamic bearing friction decay
      const decay = Math.exp(-this.friction * dt);
      this.wx *= decay;
      this.wy *= decay;
      if (speed < 0.12) {
        this.wx = 0;
        this.wy = 0;
        this.brokenOut = false; // Re-engage static stiction at rest
      }
    } else {
      this.hapticAccumRad = 0;
      this.brokenOut = false;
    }
  }

  /**
   * Returns normalized steering vector for marble physics (-1..1 in screen space).
   */
  getSteer(): { ax: number; ay: number } {
    const sp = Math.hypot(this.wx, this.wy);
    if (sp < 0.1) return { ax: 0, ay: 0 };
    // Progressive analog curve: fine subtle control at low speed, high velocity when spun hard
    const norm = Math.min(1.0, sp / (this.maxOmega * 0.85));
    const mag = Math.pow(norm, 1.35);
    return {
      ax: (this.wy / sp) * mag,
      ay: (this.wx / sp) * mag,
    };
  }

  /**
   * Rotates 3x3 matrix by an axis-angle rotation (Rodrigues formula).
   */
  private rotateAroundAxis(x: number, y: number, z: number, theta: number): void {
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const t = 1 - c;

    // Construct 3x3 delta rotation matrix (column-major)
    const d00 = t * x * x + c,     d01 = t * x * y - s * z, d02 = t * x * z + s * y;
    const d10 = t * x * y + s * z, d11 = t * y * y + c,     d12 = t * y * z - s * x;
    const d20 = t * x * z - s * y, d21 = t * y * z + s * x, d22 = t * z * z + c;

    const r = this.rot;
    // R_new = dR * R
    const r00 = d00 * r[0] + d01 * r[1] + d02 * r[2];
    const r01 = d10 * r[0] + d11 * r[1] + d12 * r[2];
    const r02 = d20 * r[0] + d21 * r[1] + d22 * r[2];

    const r10 = d00 * r[3] + d01 * r[4] + d02 * r[5];
    const r11 = d10 * r[3] + d11 * r[4] + d12 * r[5];
    const r12 = d20 * r[3] + d21 * r[4] + d22 * r[5];

    const r20 = d00 * r[6] + d01 * r[7] + d02 * r[8];
    const r21 = d10 * r[6] + d11 * r[7] + d12 * r[8];
    const r22 = d20 * r[6] + d21 * r[7] + d22 * r[8];

    r[0] = r00; r[1] = r01; r[2] = r02;
    r[3] = r10; r[4] = r11; r[5] = r12;
    r[6] = r20; r[7] = r21; r[8] = r22;

    // Orthonormalize to prevent matrix skew drift
    this.orthonormalize();
  }

  private orthonormalize(): void {
    const r = this.rot;
    // Col 0: (r0, r1, r2)
    let len0 = Math.hypot(r[0], r[1], r[2]) || 1;
    r[0] /= len0; r[1] /= len0; r[2] /= len0;

    // Col 1: (r3, r4, r5) ortho to Col 0
    const dot01 = r[0] * r[3] + r[1] * r[4] + r[2] * r[5];
    r[3] -= dot01 * r[0]; r[4] -= dot01 * r[1]; r[5] -= dot01 * r[2];
    let len1 = Math.hypot(r[3], r[4], r[5]) || 1;
    r[3] /= len1; r[4] /= len1; r[5] /= len1;

    // Col 2: cross product Col 0 x Col 1
    r[6] = r[1] * r[5] - r[2] * r[4];
    r[7] = r[2] * r[3] - r[0] * r[5];
    r[8] = r[0] * r[4] - r[1] * r[3];
  }

  private clampVelocity(): void {
    const sp = Math.hypot(this.wx, this.wy);
    if (sp > this.maxOmega) {
      const f = this.maxOmega / sp;
      this.wx *= f;
      this.wy *= f;
    }
  }

  /**
   * Safe, throttled web vibration.
   */
  vibrate(pattern: number | number[]): void {
    if (!this.enableHaptics || typeof navigator === 'undefined') return;
    const now = performance.now();
    // Throttle vibration calls to at most once every 32ms
    if (now - this.lastHapticTime < 32) return;
    this.lastHapticTime = now;
    // Inside the Android host (tiny-apk-haptics) window.NativeBridge drives the actuator with composition
    // primitives, which feel far crisper than navigator.vibrate's on/off buzz. Map the durations we use:
    //   2  detent tick   8  breakout click   12  wall bounce   25  landing / dizzy   [15,30,40]  shatter
    const nb = (window as unknown as { NativeBridge?: { tick?(s: number): void; impact?(s: number): void; thud?(): void } }).NativeBridge;
    if (nb && nb.tick && nb.impact && nb.thud) {
      try {
        const total = Array.isArray(pattern) ? pattern.reduce((a, b) => a + b, 0) : pattern;
        if (Array.isArray(pattern) || total >= 20) nb.thud();
        else if (total >= 10) nb.impact(Math.min(1, total / 16));
        else nb.tick(Math.min(1, total / 8));
      } catch { /* bridge gone */ }
      return;
    }
    if (!('vibrate' in navigator)) return;
    try {
      navigator.vibrate(pattern);
    } catch {
      // Ignore user-activation or platform restrictions
    }
  }
}
