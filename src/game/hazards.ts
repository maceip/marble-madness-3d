import { STEP_H, type BuiltLevel } from '../data/build.js';
import type { HazardDef } from '../data/types.js';
import type { MarbleState } from './physics.js';

export interface Bomb {
  x: number;
  y: number;
  z: number;
  vy: number;
  targetY: number;
  exploded: boolean;
  timer: number;
}

export interface HazardInstance {
  def: HazardDef;
  x: number;
  y: number;
  z: number;
  baseX: number;
  baseZ: number;
  rotation: number;
  active: boolean;
  collected?: boolean;
  animTime: number;
  waypointIndex?: number;
  bombs?: Bomb[];
  bombTimer?: number;
}

export interface HazardEvents {
  onCollectItem?: (item: HazardDef) => void;
  onCheckpoint?: (hazard: HazardDef) => void;
  onGoal?: () => void;
  onKill?: (reason: 'blade' | 'bat' | 'bomb' | 'snake' | 'spike') => void;
  onHitBat?: () => void;
}

export class HazardManager {
  public hazards: HazardInstance[] = [];
  public events: HazardEvents = {};
  public activeCheckpoint: [number, number, number] | null = null;

  constructor(level: BuiltLevel) {
    this.initLevel(level);
  }

  public initLevel(level: BuiltLevel): void {
    this.hazards = [];
    this.activeCheckpoint = null;

    // Combine static props and dynamic hazard defs
    const allDefs = [...level.props, ...level.def.hazards];

    for (const def of allDefs) {
      const hSteps = def.h ?? level.def.baseHeight;
      const y = hSteps * STEP_H + 0.3;

      this.hazards.push({
        def,
        x: def.x,
        y,
        z: def.z,
        baseX: def.x,
        baseZ: def.z,
        rotation: 0,
        active: true,
        collected: false,
        animTime: Math.random() * 10,
        waypointIndex: 0,
        bombs: [],
        bombTimer: Math.random() * 60,
      });
    }
  }

  public update(dt: number, marble: MarbleState): void {
    if (marble.dead) return;

    for (const h of this.hazards) {
      h.animTime += dt;
      h.rotation += dt * 5;

      // Update positions based on hazard kind
      switch (h.def.kind) {
        case 'blade': {
          // Oscillate along axis
          const range = h.def.range ?? 3;
          const period = h.def.period ?? 3.5;
          const offset = Math.sin((h.animTime / period) * Math.PI * 2) * (range / 2);
          if (h.def.axis === 'x') {
            h.x = h.baseX + offset;
          } else {
            h.z = h.baseZ + offset;
          }
          break;
        }

        case 'bat': {
          // Swoop along axis and bob in height
          const range = h.def.range ?? 3.5;
          const period = h.def.period ?? 3.2;
          const offset = Math.sin((h.animTime / period) * Math.PI * 2) * (range / 2);
          const bob = Math.sin(h.animTime * 8) * 0.4;
          if (h.def.axis === 'x') {
            h.x = h.baseX + offset;
          } else {
            h.z = h.baseZ + offset;
          }
          h.y = (h.def.h ?? 10) * STEP_H + bob;
          break;
        }

        case 'bomber': {
          // Patrol and drop bombs
          const range = h.def.range ?? 5;
          const period = h.def.period ?? 5.0;
          const offset = Math.sin((h.animTime / period) * Math.PI * 2) * (range / 2);
          if (h.def.axis === 'z') {
            h.z = h.baseZ + offset;
          } else {
            h.x = h.baseX + offset;
          }
          h.y = (h.def.h ?? 12) * STEP_H;

          // Bomb dropping logic
          h.bombTimer = (h.bombTimer ?? 0) + dt;
          if (h.bombTimer > 2.2) {
            h.bombTimer = 0;
            if (!h.bombs) h.bombs = [];
            h.bombs.push({
              x: h.x,
              y: h.y - 0.4,
              z: h.z,
              vy: 0,
              targetY: h.y - 3.5,
              exploded: false,
              timer: 0,
            });
          }

          // Update active bombs
          if (h.bombs) {
            for (const b of h.bombs) {
              if (b.exploded) {
                b.timer += dt;
              } else {
                b.vy -= 0.008;
                b.y += b.vy;
                if (b.y <= b.targetY) {
                  b.y = b.targetY;
                  b.exploded = true;
                  // Check bomb explosion radius against marble
                  const dist = Math.hypot(b.x - marble.x, b.y - marble.y, b.z - marble.z);
                  if (dist < 1.4 && !marble.dead) {
                    if (this.events.onKill) this.events.onKill('bomb');
                  }
                }
              }
            }
            h.bombs = h.bombs.filter((b) => b.timer < 0.6);
          }
          break;
        }

        case 'snake': {
          // Follow path waypoints
          const path = h.def.path;
          if (path && path.length > 1) {
            const speed = (h.def.speed ?? 0.3) * dt * 5;
            const target = path[h.waypointIndex ?? 0];
            const dx = target[0] - h.x;
            const dz = target[1] - h.z;
            const dist = Math.hypot(dx, dz);

            if (dist < 0.2) {
              h.waypointIndex = ((h.waypointIndex ?? 0) + 1) % path.length;
            } else {
              h.x += (dx / dist) * speed;
              h.z += (dz / dist) * speed;
            }
          }
          break;
        }
      }

      // Check collision with marble
      if (h.active && !marble.dead) {
        const dx = h.x - marble.x;
        const dy = h.y - marble.y;
        const dz = h.z - marble.z;
        const dist2D = Math.hypot(dx, dz);
        const dist3D = Math.hypot(dx, dy, dz);

        switch (h.def.kind) {
          case 'item':
            if (dist3D < 0.7 && !h.collected) {
              h.collected = true;
              h.active = false;
              if (this.events.onCollectItem) this.events.onCollectItem(h.def);
            }
            break;

          case 'checkpoint':
            if (dist2D < 0.9 && Math.abs(dy) < 1.0) {
              if (!this.activeCheckpoint || this.activeCheckpoint[0] !== h.x || this.activeCheckpoint[2] !== h.z) {
                this.activeCheckpoint = [h.x, h.y + 0.3, h.z];
                if (this.events.onCheckpoint) this.events.onCheckpoint(h.def);
              }
            }
            break;

          case 'goal':
            if (dist2D < 0.8 && Math.abs(dy) < 1.0) {
              if (this.events.onGoal) this.events.onGoal();
            }
            break;

          case 'blade':
            if (dist2D < 0.65 && Math.abs(dy) < 0.7) {
              if (this.events.onKill) this.events.onKill('blade');
            }
            break;

          case 'bat':
            if (dist3D < 0.75) {
              // Bat knocks marble and pushes velocity
              marble.vx += (marble.x - h.x) * 0.15;
              marble.vz += (marble.z - h.z) * 0.15;
              if (this.events.onHitBat) this.events.onHitBat();
            }
            break;

          case 'snake':
            if (dist2D < 0.7 && Math.abs(dy) < 0.7) {
              if (this.events.onKill) this.events.onKill('snake');
            }
            break;
        }
      }
    }
  }
}
