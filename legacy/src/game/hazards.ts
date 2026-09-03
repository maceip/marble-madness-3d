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
  vx?: number;
  vy?: number;
  vz?: number;
  baseX: number;
  baseZ: number;
  rotation: number;
  active: boolean;
  collected?: boolean;
  animTime: number;
  waypointIndex?: number;
  bombs?: Bomb[];
  bombTimer?: number;
  jawOpen?: number;
  emerged?: number;
  cooldown?: number;
  lastBumpedTime?: number;
}

export interface HazardEvents {
  onCollectItem?: (item: HazardDef) => void;
  onCheckpoint?: (hazard: HazardDef) => void;
  onGoal?: () => void;
  onKill?: (reason: 'blade' | 'bat' | 'bomb' | 'snake' | 'spike' | 'muncher' | 'acid') => void;
  onHitBat?: () => void;
  onSteelieBump?: (steelie: HazardInstance, force: number) => void;
  onSteelieCracked?: (steelie: HazardInstance) => void;
}

export class HazardManager {
  public hazards: HazardInstance[] = [];
  public events: HazardEvents = {};
  public activeCheckpoint: [number, number, number] | null = null;
  public level!: BuiltLevel;

  constructor(level: BuiltLevel) {
    this.initLevel(level);
  }

  public initLevel(level: BuiltLevel): void {
    this.level = level;
    this.hazards = [];
    this.activeCheckpoint = null;

    // Combine static props and dynamic hazard defs
    const allDefs = [...level.props, ...level.def.hazards];

    for (const def of allDefs) {
      const hSteps = level.def.baseHeight + (def.h ?? 0);
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

        case 'steelie': {
          // Steelie AI: Black rival marble hunts player marble when in range
          const dx = marble.x - h.x;
          const dz = marble.z - h.z;
          const dist = Math.hypot(dx, dz);

          if (dist < 8.5 && dist > 0.01) {
            const huntSpeed = 0.007;
            h.vx = (h.vx ?? 0) * 0.96 + (dx / dist) * huntSpeed;
            h.vz = (h.vz ?? 0) * 0.96 + (dz / dist) * huntSpeed;
          } else {
            // Patrol orbit around base position
            const wanderAngle = h.animTime * 1.5;
            const targetX = h.baseX + Math.cos(wanderAngle) * (h.def.range ?? 2.0);
            const targetZ = h.baseZ + Math.sin(wanderAngle) * (h.def.range ?? 2.0);
            h.vx = (h.vx ?? 0) * 0.92 + (targetX - h.x) * 0.02;
            h.vz = (h.vz ?? 0) * 0.92 + (targetZ - h.z) * 0.02;
          }

          h.x += h.vx ?? 0;
          h.z += h.vz ?? 0;

          // Steelie falling into void / knocked off edge
          if (h.y < -3.5 && h.active) {
            h.active = false;
            if (this.events.onSteelieCracked) {
              this.events.onSteelieCracked(h);
            }
          }
          break;
        }

        case 'muncher': {
          // Marble Muncher: emerges and snaps jaws when marble gets close
          const dist = Math.hypot(marble.x - h.x, marble.z - h.z);
          if (dist < 3.8) {
            h.emerged = Math.min(1.0, (h.emerged ?? 0) + dt * 4.0);
            h.jawOpen = Math.sin(h.animTime * 14) * 0.5 + 0.5;
          } else {
            h.emerged = Math.max(0.0, (h.emerged ?? 0) - dt * 2.5);
            h.jawOpen = 0;
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

        case 'windmill': {
          h.rotation += dt * (h.def.rotationSpeed ?? 2.8);
          const rad = h.def.radius ?? 3.2;
          const dist2D = Math.hypot(marble.x - h.x, marble.z - h.z);
          const dy = Math.abs(marble.y - h.y);
          if (dist2D < rad && dy < 0.9 && !marble.dead) {
            const currentAngle = Math.atan2(marble.z - h.z, marble.x - h.x);
            for (let b = 0; b < 4; b++) {
              const bladeAngle = (h.rotation + (b * Math.PI) / 2) % (Math.PI * 2);
              let angleDiff = Math.abs(currentAngle - bladeAngle);
              if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;
              if (angleDiff < 0.28) {
                const now = performance.now();
                if (now - (h.cooldown ?? 0) > 400) {
                  h.cooldown = now;
                  const pushAngle = bladeAngle + Math.PI / 2;
                  const impulse = 0.42;
                  marble.vx += Math.cos(pushAngle) * impulse;
                  marble.vz += Math.sin(pushAngle) * impulse;
                  marble.vy += 0.28;
                  if (this.events.onHitBat) this.events.onHitBat();
                }
              }
            }
          }
          break;
        }
      }

      // Check collision with marble (immune while in tube)
      if (h.active && !marble.dead && !marble.inTube) {
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

          case 'steelie': {
            if (dist3D < 0.55) {
              const now = performance.now();
              if (now - (h.cooldown ?? 0) > 500) {
                h.cooldown = now;
                const nx = dx / (dist3D || 1);
                const nz = dz / (dist3D || 1);
                const bumpForce = 0.38;

                // Impulse applied to player
                marble.vx -= nx * bumpForce;
                marble.vz -= nz * bumpForce;
                marble.vy += 0.22;

                // Impulse applied to Steelie
                h.vx = (h.vx ?? 0) + nx * bumpForce * 0.8;
                h.vz = (h.vz ?? 0) + nz * bumpForce * 0.8;

                if (this.events.onSteelieBump) {
                  this.events.onSteelieBump(h, bumpForce);
                } else if (this.events.onHitBat) {
                  this.events.onHitBat();
                }
              }
            }
            break;
          }

          case 'muncher':
            if ((h.emerged ?? 0) > 0.5 && dist2D < 0.52 && Math.abs(dy) < 0.6) {
              if (this.events.onKill) this.events.onKill('muncher');
            }
            break;

          case 'acid':
            if (dist2D < 0.65 && Math.abs(dy) < 0.5) {
              if (this.events.onKill) this.events.onKill('acid');
            }
            break;

          case 'snake':
            if (dist2D < 0.7 && Math.abs(dy) < 0.7) {
              if (this.events.onKill) this.events.onKill('snake');
            }
            break;

          case 'springboard':
            if (dist2D < 0.75 && Math.abs(dy) < 0.7) {
              const now = performance.now();
              if (now - (h.cooldown ?? 0) > 600) {
                h.cooldown = now;
                marble.vy = 0.44;
                marble.grounded = false;
                if (this.events.onHitBat) this.events.onHitBat();
              }
            }
            break;

          case 'funnel': {
            const captureRadius = 1.4;
            const suctionRadius = 3.0;
            if (dist2D < suctionRadius && Math.abs(dy) < 2.0 && !marble.inTube && !marble.dead) {
              if (dist2D < captureRadius) {
                marble.inTube = true;
                marble.tubeProgress = 0;
                marble.tubeDuration = h.def.period ?? 0.8;
                const targetWorldY = (this.level.def.baseHeight + (h.def.targetY ?? (h.def.h ?? 0))) * STEP_H + 0.3;
                marble.tubePath = h.def.curvePath ?? [
                  [h.x, h.y, h.z],
                  [h.def.targetX ?? h.x, (h.y + targetWorldY) / 2, (h.z + (h.def.targetZ ?? h.z)) / 2],
                  [h.def.targetX ?? h.x, targetWorldY, h.def.targetZ ?? (h.z + 2)],
                ];
                marble.tubeExitVel = h.def.exitVelocity ?? [0.06, 0.02, 0.16];
                if (this.events.onHitBat) this.events.onHitBat();
              } else {
                // Funnel suction vortex pulls marble inward towards center of hopper
                const pullStrength = ((suctionRadius - dist2D) / suctionRadius) * 0.065;
                marble.vx += (dx / dist2D) * pullStrength;
                marble.vz += (dz / dist2D) * pullStrength;
              }
            }
            break;
          }

          case 'tube':
          case 'spigot': {
            const captureRadius = 1.3;
            if (dist2D < captureRadius && Math.abs(dy) < 1.8 && !marble.inTube && !marble.dead) {
              marble.inTube = true;
              marble.tubeProgress = 0;
              marble.tubeDuration = h.def.period ?? 0.8;
              const targetWorldY = (this.level.def.baseHeight + (h.def.targetY ?? (h.def.h ?? 0))) * STEP_H + 0.3;
              marble.tubePath = h.def.curvePath ?? [
                [h.x, h.y, h.z],
                [h.def.targetX ?? h.x, (h.y + targetWorldY) / 2, (h.z + (h.def.targetZ ?? h.z)) / 2],
                [h.def.targetX ?? h.x, targetWorldY, h.def.targetZ ?? (h.z + 2)],
              ];
              marble.tubeExitVel = h.def.exitVelocity ?? [0.06, 0.02, 0.16];
              if (this.events.onHitBat) this.events.onHitBat();
            }
            break;
          }
        }
      }
    }
  }
}
