import { cellAt, STEP_H, type BuiltLevel } from '../data/build.js';
import type { Cell } from '../data/types.js';
import {
  MABLE_R,
  MAX_SPEED,
  MAX_SPEED_AIR,
  TERMINAL_FALL,
  SPIKE_BOUNCE,
} from '../lib/constants.js';
import type { InputState } from './input.js';

export interface MarbleState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** 3D rotation Euler angles for rolling sphere (radians) */
  rotX: number;
  rotY: number;
  rotZ: number;
  /** True 3D quaternion components [x, y, z, w] */
  quat: [number, number, number, number];
  /** 3D angular velocity vector [wx, wy, wz] (rad/s) */
  omega: [number, number, number];
  grounded: boolean;
  dead: boolean;
  shattered: boolean;
  skidding: boolean;
  currentCell: Cell | null;
  speed: number;
  angularSpeed: number;
  inWater: boolean;
  fallHeight: number;
  lastAirY: number;
}

export interface PhysicsEvents {
  onBounce?: (force: number) => void;
  onShatter?: () => void;
  onSkid?: (intensity: number) => void;
  onFall?: () => void;
  onSpringboard?: () => void;
  onSplash?: () => void;
}

// =========================================================================
// QUATERNION & VECTOR 3D MATH HELPERS (Pure high-performance math)
// =========================================================================

function quatNormalize(q: [number, number, number, number]): [number, number, number, number] {
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  if (len < 1e-6) return [0, 0, 0, 1];
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

function quatMultiply(
  a: [number, number, number, number],
  b: [number, number, number, number],
): [number, number, number, number] {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function quatFromAxisAngle(
  ax: number,
  ay: number,
  az: number,
  angle: number,
): [number, number, number, number] {
  const len = Math.hypot(ax, ay, az);
  if (len < 1e-6) return [0, 0, 0, 1];
  const half = angle * 0.5;
  const s = Math.sin(half) / len;
  return [ax * s, ay * s, az * s, Math.cos(half)];
}

export class PhysicsEngine {
  private level: BuiltLevel;
  public marble: MarbleState;
  public events: PhysicsEvents = {};

  private readonly GRAVITY = -0.015;
  private readonly ACCEL = 0.0018;
  private readonly BRAKE_DRAG = 0.78;
  private readonly SHATTER_VELOCITY = -0.42; // Falling faster than this splatters marble!

  constructor(level: BuiltLevel) {
    this.level = level;
    this.marble = this.createInitialState();
  }

  public setLevel(level: BuiltLevel): void {
    this.level = level;
    this.respawn();
  }

  public createInitialState(): MarbleState {
    const [startX, startZ] = this.level.def.start;
    const c = Math.floor(startX);
    const r = Math.floor(startZ);
    const cell = cellAt(this.level.layout, c, r);
    const groundY = (cell ? cell.H : this.level.def.baseHeight) * STEP_H + MABLE_R;

    return {
      x: startX,
      y: groundY + 0.1,
      z: startZ,
      vx: 0,
      vy: 0,
      vz: 0,
      rotX: 0,
      rotY: 0,
      rotZ: 0,
      quat: [0, 0, 0, 1],
      omega: [0, 0, 0],
      grounded: true,
      dead: false,
      shattered: false,
      skidding: false,
      currentCell: cell ?? null,
      speed: 0,
      angularSpeed: 0,
      inWater: false,
      fallHeight: 0,
      lastAirY: groundY,
    };
  }

  public respawn(atPos?: [number, number, number]): void {
    if (atPos) {
      this.marble.x = atPos[0];
      this.marble.y = atPos[1];
      this.marble.z = atPos[2];
    } else {
      const [startX, startZ] = this.level.def.start;
      const c = Math.floor(startX);
      const r = Math.floor(startZ);
      const cell = cellAt(this.level.layout, c, r);
      this.marble.x = startX;
      this.marble.z = startZ;
      this.marble.y = ((cell ? cell.H : this.level.def.baseHeight) * STEP_H) + MABLE_R + 0.5;
    }
    this.marble.vx = 0;
    this.marble.vy = 0;
    this.marble.vz = 0;
    this.marble.omega = [0, 0, 0];
    this.marble.grounded = false;
    this.marble.dead = false;
    this.marble.shattered = false;
    this.marble.skidding = false;
    this.marble.fallHeight = 0;
    this.marble.lastAirY = this.marble.y;
  }

  public getGroundHeightAt(x: number, z: number): { height: number; cell: Cell | null; normal: [number, number, number] } {
    const c = Math.floor(x);
    const r = Math.floor(z);
    const cell = cellAt(this.level.layout, c, r);

    if (!cell || cell.surf === 'void') {
      return { height: -100, cell: null, normal: [0, 1, 0] };
    }

    if (cell.surf === 'holo') {
      // Marble falls through holo decks
      return { height: -100, cell, normal: [0, 1, 0] };
    }

    const u = x - c - 0.5; // -0.5 .. 0.5
    const v = z - r - 0.5; // -0.5 .. 0.5

    // Interpolate height across sloped ramps
    // dx > 0 means height slopes down towards +X; dz > 0 slopes down towards +Z
    const slopeX = -cell.dx * STEP_H * 0.5;
    const slopeZ = -cell.dz * STEP_H * 0.5;

    const baseH = cell.H * STEP_H;
    const h = baseH + (u * slopeX + v * slopeZ);

    // Normal calculation
    const nx = -slopeX;
    const ny = 1.0;
    const nz = -slopeZ;
    const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);

    return {
      height: h,
      cell,
      normal: [nx / nLen, ny / nLen, nz / nLen],
    };
  }

  public update(input: InputState): void {
    if (this.marble.dead || this.marble.shattered) return;

    const m = this.marble;
    const groundInfo = this.getGroundHeightAt(m.x, m.z);
    m.currentCell = groundInfo.cell;

    // Surface traction & friction properties
    let surfaceFriction = 0.984;
    let surfaceTraction = 0.85;
    let steerForce = this.ACCEL * input.intensity;

    if (groundInfo.cell) {
      switch (groundInfo.cell.surf) {
        case 'snow':
          // Ice: super slick, low traction (causes drifting and spinning)
          surfaceFriction = 0.996;
          surfaceTraction = 0.22;
          steerForce *= 0.55;
          break;
        case 'sand':
          // Sand: heavy rolling resistance and low top speed
          surfaceFriction = 0.92;
          surfaceTraction = 0.95;
          steerForce *= 1.25;
          break;
        case 'metal':
          // Metal rails: crisp, high speed
          surfaceFriction = 0.99;
          surfaceTraction = 0.9;
          break;
        case 'glass':
          surfaceFriction = 0.992;
          surfaceTraction = 0.45;
          break;
        case 'water':
          surfaceFriction = 0.90;
          surfaceTraction = 0.35;
          m.inWater = true;
          break;
        default:
          m.inWater = false;
          break;
      }
    }

    if (m.grounded) {
      // 1. Steering & Trackball Acceleration
      m.vx += input.steerX * steerForce;
      m.vz += input.steerZ * steerForce;

      // 2. Analytical Downhill Slope Acceleration
      // Normal vector components nx, nz correspond to slope gradient
      const [nx, ny, nz] = groundInfo.normal;
      if (ny < 0.99) {
        // Ramps / banked slopes accelerate marble downhill
        const slopeGravity = 0.018;
        m.vx += nx * slopeGravity * (1.0 - ny);
        m.vz += nz * slopeGravity * (1.0 - ny);
      }

      // 3. Friction & Braking
      if (input.brake) {
        m.vx *= this.BRAKE_DRAG;
        m.vz *= this.BRAKE_DRAG;
      } else {
        m.vx *= surfaceFriction;
        m.vz *= surfaceFriction;
      }

      // 4. Speed Cap
      const currentSpeed = Math.hypot(m.vx, m.vz);
      if (currentSpeed > MAX_SPEED) {
        const factor = MAX_SPEED / currentSpeed;
        m.vx *= factor;
        m.vz *= factor;
      }
      m.speed = currentSpeed;

      // 5. Skid & Drift Detection
      // Desired rolling angular velocity: omega = (n x v) / R
      const targetOmegaX = -m.vz / MABLE_R;
      const targetOmegaZ = m.vx / MABLE_R;
      const omegaDiff = Math.hypot(targetOmegaX - m.omega[0], targetOmegaZ - m.omega[2]);

      // Traction smoothly aligns marble angular spin with translational velocity
      m.omega[0] += (targetOmegaX - m.omega[0]) * surfaceTraction;
      m.omega[2] += (targetOmegaZ - m.omega[2]) * surfaceTraction;

      if (omegaDiff > 0.8 && currentSpeed > 0.15) {
        m.skidding = true;
        if (this.events.onSkid) this.events.onSkid(Math.min(1, omegaDiff / 2));
      } else {
        m.skidding = false;
      }
    } else {
      // Airborne Physics: Gravity & Drag
      m.vy += this.GRAVITY;
      if (m.vy < -TERMINAL_FALL) m.vy = -TERMINAL_FALL;

      // Subtle air steering control
      m.vx += input.steerX * (steerForce * 0.35);
      m.vz += input.steerZ * (steerForce * 0.35);
      m.vx *= 0.994;
      m.vz *= 0.994;

      const airSpeed = Math.hypot(m.vx, m.vz);
      if (airSpeed > MAX_SPEED_AIR) {
        const factor = MAX_SPEED_AIR / airSpeed;
        m.vx *= factor;
        m.vz *= factor;
      }
      m.speed = airSpeed;
      m.skidding = false;

      // Angular velocity spins freely with slight air damping
      m.omega[0] *= 0.995;
      m.omega[2] *= 0.995;
    }

    // Integrate Position
    const nextX = m.x + m.vx;
    const nextZ = m.z + m.vz;
    const nextY = m.y + m.vy;

    // Wall Collision against Solid Cells
    const nextCell = cellAt(this.level.layout, Math.floor(nextX), Math.floor(nextZ));
    if (nextCell && nextCell.solid) {
      const cellX = cellAt(this.level.layout, Math.floor(nextX), Math.floor(m.z));
      const cellZ = cellAt(this.level.layout, Math.floor(m.x), Math.floor(nextZ));

      if (cellX && cellX.solid) {
        m.vx = -m.vx * 0.45;
        if (this.events.onBounce && Math.abs(m.vx) > 0.05) this.events.onBounce(Math.abs(m.vx));
      } else {
        m.x = nextX;
      }

      if (cellZ && cellZ.solid) {
        m.vz = -m.vz * 0.45;
        if (this.events.onBounce && Math.abs(m.vz) > 0.05) this.events.onBounce(Math.abs(m.vz));
      } else {
        m.z = nextZ;
      }
    } else {
      m.x = nextX;
      m.z = nextZ;
    }

    // Ground & Vertical Collision
    const nextGround = this.getGroundHeightAt(m.x, m.z);
    const requiredY = nextGround.height + MABLE_R;

    if (nextY <= requiredY) {
      if (!m.grounded && m.vy < -0.12) {
        // Landing Impact Assessment
        const fallDist = m.lastAirY - nextY;

        // HIGH DROP SPLAT: Shatter on excessive fall or downward impact velocity!
        if (m.vy <= this.SHATTER_VELOCITY || fallDist > 2.2) {
          m.y = requiredY;
          m.vy = 0;
          m.vx = 0;
          m.vz = 0;
          m.dead = true;
          m.shattered = true;
          if (this.events.onShatter) {
            this.events.onShatter();
          } else if (this.events.onBounce) {
            this.events.onBounce(1.0);
          }
          return;
        }

        // Moderate Drop: Elastic Rebound Bounce
        if (this.events.onBounce) this.events.onBounce(Math.abs(m.vy) * 1.8);
        m.vy = -m.vy * 0.28;
        m.y = requiredY + 0.02;
        if (Math.abs(m.vy) < 0.04) {
          m.vy = 0;
          m.grounded = true;
        }
      } else {
        m.y = requiredY;
        m.vy = 0;
        m.grounded = true;
        m.lastAirY = m.y;
      }

      // Check for Springboards
      if (nextGround.cell?.prop === 'springboard') {
        m.vy = 0.48;
        m.grounded = false;
        m.lastAirY = m.y;
        if (this.events.onSpringboard) this.events.onSpringboard();
      }

      // Check for Spikes Bounce / Kill
      if (nextGround.cell?.prop === 'spike') {
        m.vy = SPIKE_BOUNCE;
        m.grounded = false;
        m.lastAirY = m.y;
        if (this.events.onBounce) this.events.onBounce(1.0);
      }
    } else {
      m.y = nextY;
      if (nextY - requiredY > 0.18) {
        if (m.grounded) {
          m.lastAirY = m.y;
        }
        m.grounded = false;
      }
    }

    // 6. True 3D Angular Velocity Integration into Quaternion
    const angMag = Math.hypot(m.omega[0], m.omega[1], m.omega[2]);
    m.angularSpeed = angMag;
    if (angMag > 1e-5) {
      const deltaQuat = quatFromAxisAngle(
        m.omega[0] / angMag,
        m.omega[1] / angMag,
        m.omega[2] / angMag,
        angMag * (1 / 60),
      );
      m.quat = quatNormalize(quatMultiply(deltaQuat, m.quat));
    }

    // Keep Euler angles in sync for UI/legacy renderers
    m.rotX += m.vz * 2.8;
    m.rotZ -= m.vx * 2.8;

    // Check Void Fall / Death
    if (m.y < -15) {
      m.dead = true;
      if (this.events.onFall) this.events.onFall();
    }
  }
}
