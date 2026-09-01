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
  /** 3x3 visual rotation matrix components for rolling sphere */
  rotX: number;
  rotY: number;
  rotZ: number;
  grounded: boolean;
  dead: boolean;
  currentCell: Cell | null;
  speed: number;
  inWater: boolean;
  fallHeight: number;
}

export interface PhysicsEvents {
  onBounce?: (force: number) => void;
  onFall?: () => void;
  onSpringboard?: () => void;
  onSplash?: () => void;
}

export class PhysicsEngine {
  private level: BuiltLevel;
  public marble: MarbleState;
  public events: PhysicsEvents = {};

  private readonly GRAVITY = -0.014;
  private readonly ACCEL = 0.012;
  private readonly BRAKE_DRAG = 0.88;

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
      grounded: true,
      dead: false,
      currentCell: cell ?? null,
      speed: 0,
      inWater: false,
      fallHeight: 0,
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
    this.marble.grounded = false;
    this.marble.dead = false;
    this.marble.fallHeight = 0;
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
    if (this.marble.dead) return;

    const m = this.marble;

    // Apply player steering input
    let steerForce = this.ACCEL * input.intensity;
    let surfaceFriction = 0.982;

    const groundInfo = this.getGroundHeightAt(m.x, m.z);
    m.currentCell = groundInfo.cell;

    // Surface specific physics modifiers
    if (groundInfo.cell) {
      switch (groundInfo.cell.surf) {
        case 'snow':
          // Ice: slippery, fast, low friction
          surfaceFriction = 0.994;
          steerForce *= 0.65;
          break;
        case 'sand':
          // Sand: high drag, slow
          surfaceFriction = 0.93;
          steerForce *= 1.3;
          break;
        case 'water':
          // Water: slow, dragging down
          surfaceFriction = 0.91;
          m.inWater = true;
          break;
        case 'metal':
          // Metal rails: fast
          surfaceFriction = 0.988;
          break;
        case 'glass':
          surfaceFriction = 0.99;
          break;
        default:
          m.inWater = false;
          break;
      }
    }

    if (m.grounded) {
      // Ground acceleration & slopes
      m.vx += input.steerX * steerForce;
      m.vz += input.steerZ * steerForce;

      // Apply slope gravity pull
      if (groundInfo.cell && (groundInfo.cell.dx !== 0 || groundInfo.cell.dz !== 0)) {
        m.vx += groundInfo.cell.dx * 0.007;
        m.vz += groundInfo.cell.dz * 0.007;
      }

      // Apply friction or braking
      if (input.brake) {
        m.vx *= this.BRAKE_DRAG;
        m.vz *= this.BRAKE_DRAG;
      } else {
        m.vx *= surfaceFriction;
        m.vz *= surfaceFriction;
      }

      // Speed cap on ground
      const currentSpeed = Math.sqrt(m.vx * m.vx + m.vz * m.vz);
      if (currentSpeed > MAX_SPEED) {
        const factor = MAX_SPEED / currentSpeed;
        m.vx *= factor;
        m.vz *= factor;
      }

      m.speed = currentSpeed;
    } else {
      // Airborne physics
      m.vy += this.GRAVITY;
      if (m.vy < -TERMINAL_FALL) m.vy = -TERMINAL_FALL;

      // Air control
      m.vx += input.steerX * (steerForce * 0.4);
      m.vz += input.steerZ * (steerForce * 0.4);
      m.vx *= 0.992;
      m.vz *= 0.992;

      const airSpeed = Math.sqrt(m.vx * m.vx + m.vz * m.vz);
      if (airSpeed > MAX_SPEED_AIR) {
        const factor = MAX_SPEED_AIR / airSpeed;
        m.vx *= factor;
        m.vz *= factor;
      }
      m.speed = airSpeed;
    }

    // Integrate position
    const nextX = m.x + m.vx;
    const nextZ = m.z + m.vz;
    const nextY = m.y + m.vy;

    // Wall collision against solid cells
    const nextCell = cellAt(this.level.layout, Math.floor(nextX), Math.floor(nextZ));
    if (nextCell && nextCell.solid) {
      // Check X and Z components independently for sliding against walls
      const cellX = cellAt(this.level.layout, Math.floor(nextX), Math.floor(m.z));
      const cellZ = cellAt(this.level.layout, Math.floor(m.x), Math.floor(nextZ));

      if (cellX && cellX.solid) {
        m.vx = -m.vx * 0.4;
        if (this.events.onBounce && Math.abs(m.vx) > 0.05) this.events.onBounce(Math.abs(m.vx));
      } else {
        m.x = nextX;
      }

      if (cellZ && cellZ.solid) {
        m.vz = -m.vz * 0.4;
        if (this.events.onBounce && Math.abs(m.vz) > 0.05) this.events.onBounce(Math.abs(m.vz));
      } else {
        m.z = nextZ;
      }
    } else {
      m.x = nextX;
      m.z = nextZ;
    }

    // Ground & vertical collision
    const nextGround = this.getGroundHeightAt(m.x, m.z);
    const requiredY = nextGround.height + MABLE_R;

    if (nextY <= requiredY) {
      if (!m.grounded && m.vy < -0.15) {
        // Hard landing / bounce
        if (this.events.onBounce) this.events.onBounce(Math.abs(m.vy));
        if (m.vy < -0.45) {
          // Landing bounce
          m.vy = -m.vy * 0.35;
          m.y = requiredY + 0.02;
        } else {
          m.y = requiredY;
          m.vy = 0;
          m.grounded = true;
        }
      } else {
        m.y = requiredY;
        m.vy = 0;
        m.grounded = true;
      }

      // Check for springboards
      if (nextGround.cell?.prop === 'springboard') {
        m.vy = 0.46;
        m.grounded = false;
        if (this.events.onSpringboard) this.events.onSpringboard();
      }

      // Check for spikes bounce / kill
      if (nextGround.cell?.prop === 'spike') {
        m.vy = SPIKE_BOUNCE;
        m.grounded = false;
        if (this.events.onBounce) this.events.onBounce(1.0);
      }
    } else {
      m.y = nextY;
      // If marble stepped off a cliff
      if (nextY - requiredY > 0.25) {
        m.grounded = false;
      }
    }

    // Update 3D rolling orientation
    // Visual roll angle depends on velocity
    m.rotX += m.vz * 2.8;
    m.rotZ -= m.vx * 2.8;

    // Check void fall / death
    if (m.y < -15) {
      m.dead = true;
      if (this.events.onFall) this.events.onFall();
    }
  }
}
