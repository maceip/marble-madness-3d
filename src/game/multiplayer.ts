import type { MarbleState } from './physics.js';
import { MABLE_R } from '../lib/constants.js';

export interface RemotePlayer {
  id: string;
  name: string;
  color: string;
  intelligence?: 'AI' | 'NI';
  stage: number;
  x: number;
  y: number;
  z: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  vx: number;
  vy: number;
  vz: number;
  rotX: number;
  rotZ: number;
  speed: number;
  score: number;
  lastUpdate: number;
  lastBumpedBy?: string;
  lastBumpTime?: number;
}

export interface MultiplayerEvents {
  onPlayerJoined?: (player: RemotePlayer) => void;
  onPlayerLeft?: (id: string, name: string) => void;
  onBumpReceived?: (attackerName: string, impulse: [number, number, number]) => void;
  onBumpScored?: (targetName: string, points: number) => void;
  onKnockoutScored?: (targetName: string, targetIntelligence: 'AI' | 'NI', points: number) => void;
  onPlayerCountChange?: (count: number) => void;
}

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  public localId: string = '';
  public localName: string = '';
  public localColor: string = '#ff3b5c';
  public localIntelligence: 'AI' | 'NI' = 'NI';
  public remotePlayers = new Map<string, RemotePlayer>();
  public isConnected = false;
  public events: MultiplayerEvents = {};

  private lastSendTime = 0;
  private readonly SEND_INTERVAL = 1000 / 30; // 30Hz update rate
  private bumpCooldown = new Map<string, number>();

  constructor() {
    this.connect();
  }

  public setIntelligenceType(type: 'AI' | 'NI'): void {
    this.localIntelligence = type;
    if (type === 'AI' && !this.localName.includes('[AI]')) {
      this.localName = `[AI] ${this.localName.replace(/^\[NI\]\s*/, '')}`;
    }
  }

  public connect(): void {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host || 'localhost:3000';
    const wsUrl = `${protocol}//${host}/ws`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        console.log('[Multiplayer] Connected to hosted server:', wsUrl);
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.remotePlayers.clear();
        this.notifyPlayerCount();
        // Retry connection after delay
        setTimeout(() => this.connect(), 4000);
      };

      this.ws.onerror = () => {
        this.isConnected = false;
      };
    } catch (e) {
      console.warn('[Multiplayer] Connection failed:', e);
    }
  }

  private handleMessage(data: string): void {
    try {
      const msg = JSON.parse(data);

      switch (msg.type) {
        case 'welcome': {
          this.localId = msg.id;
          this.localName = msg.name;
          this.localColor = msg.color;
          console.log(`[Multiplayer] Welcomed as ${this.localName} (${this.localId})`);

          if (Array.isArray(msg.players)) {
            for (const p of msg.players) {
              this.addOrUpdateRemotePlayer(p);
            }
          }
          this.notifyPlayerCount();
          break;
        }

        case 'player_joined': {
          if (msg.player && msg.player.id !== this.localId) {
            const rp = this.addOrUpdateRemotePlayer(msg.player);
            if (this.events.onPlayerJoined) this.events.onPlayerJoined(rp);
            this.notifyPlayerCount();
          }
          break;
        }

        case 'world_tick': {
          if (Array.isArray(msg.players)) {
            const currentIds = new Set<string>();
            for (const p of msg.players) {
              if (p.id === this.localId) continue;
              currentIds.add(p.id);
              this.addOrUpdateRemotePlayer(p);
            }
            // Remove players no longer present in tick snapshot
            for (const id of this.remotePlayers.keys()) {
              if (!currentIds.has(id)) {
                this.remotePlayers.delete(id);
              }
            }
            this.notifyPlayerCount();
          }
          break;
        }

        case 'player_update': {
          if (msg.id !== this.localId) {
            let rp = this.remotePlayers.get(msg.id);
            if (!rp) {
              rp = {
                id: msg.id,
                name: msg.name || `Player #${msg.id.slice(-4)}`,
                color: msg.color || '#33e0ff',
                intelligence: msg.intelligence || 'NI',
                stage: msg.stage ?? 1,
                x: msg.x ?? 3.4,
                y: msg.y ?? 6.5,
                z: msg.z ?? 2.0,
                targetX: msg.x ?? 3.4,
                targetY: msg.y ?? 6.5,
                targetZ: msg.z ?? 2.0,
                vx: msg.vx ?? 0,
                vy: msg.vy ?? 0,
                vz: msg.vz ?? 0,
                rotX: msg.rotX ?? 0,
                rotZ: msg.rotZ ?? 0,
                speed: msg.speed ?? 0,
                score: msg.score ?? 0,
                lastUpdate: performance.now(),
              };
              this.remotePlayers.set(msg.id, rp);
              this.notifyPlayerCount();
            } else {
              if (msg.name) rp.name = msg.name;
              if (msg.color) rp.color = msg.color;
              if (msg.intelligence) rp.intelligence = msg.intelligence;
              rp.stage = msg.stage;
              rp.targetX = msg.x;
              rp.targetY = msg.y;
              rp.targetZ = msg.z;
              rp.vx = msg.vx;
              rp.vy = msg.vy;
              rp.vz = msg.vz;
              rp.rotX = msg.rotX;
              rp.rotZ = msg.rotZ;
              rp.speed = msg.speed;
              rp.score = msg.score;
              rp.lastUpdate = performance.now();
            }
          }
          break;
        }

        case 'player_bumped': {
          if (msg.targetId === this.localId) {
            if (this.events.onBumpReceived) {
              this.events.onBumpReceived(msg.attackerName, [
                msg.impulseX,
                msg.impulseY,
                msg.impulseZ,
              ]);
            }
          } else if (msg.attackerId === this.localId) {
            if (this.events.onBumpScored) {
              this.events.onBumpScored(msg.targetName, msg.points ?? 250);
            }
          }
          break;
        }

        case 'player_knockout': {
          if (msg.attackerId === this.localId) {
            if (this.events.onKnockoutScored) {
              this.events.onKnockoutScored(
                msg.targetName,
                msg.targetIntelligence ?? 'NI',
                msg.points ?? 2500,
              );
            }
          }
          break;
        }

        case 'player_left': {
          const rp = this.remotePlayers.get(msg.id);
          const name = rp?.name || 'Player';
          this.remotePlayers.delete(msg.id);
          if (this.events.onPlayerLeft) this.events.onPlayerLeft(msg.id, name);
          this.notifyPlayerCount();
          break;
        }
      }
    } catch (e) {
      console.warn('[Multiplayer] Failed to parse message:', e);
    }
  }

  private addOrUpdateRemotePlayer(p: Partial<RemotePlayer> & { id: string }): RemotePlayer {
    let rp = this.remotePlayers.get(p.id);
    if (!rp) {
      rp = {
        id: p.id,
        name: p.name || `Player #${p.id.slice(-4)}`,
        color: p.color || '#33e0ff',
        intelligence: p.intelligence || 'NI',
        stage: p.stage ?? 1,
        x: p.x ?? 3.4,
        y: p.y ?? 6.5,
        z: p.z ?? 2.0,
        targetX: p.x ?? 3.4,
        targetY: p.y ?? 6.5,
        targetZ: p.z ?? 2.0,
        vx: p.vx ?? 0,
        vy: p.vy ?? 0,
        vz: p.vz ?? 0,
        rotX: p.rotX ?? 0,
        rotZ: p.rotZ ?? 0,
        speed: p.speed ?? 0,
        score: p.score ?? 0,
        lastUpdate: performance.now(),
      };
      this.remotePlayers.set(p.id, rp);
    } else {
      if (p.name) rp.name = p.name;
      if (p.color) rp.color = p.color;
      if (p.intelligence) rp.intelligence = p.intelligence;
      if (p.stage !== undefined) rp.stage = p.stage;
      if (p.x !== undefined) rp.targetX = p.x;
      if (p.y !== undefined) rp.targetY = p.y;
      if (p.z !== undefined) rp.targetZ = p.z;
      if (p.vx !== undefined) rp.vx = p.vx;
      if (p.vy !== undefined) rp.vy = p.vy;
      if (p.vz !== undefined) rp.vz = p.vz;
      if (p.rotX !== undefined) rp.rotX = p.rotX;
      if (p.rotZ !== undefined) rp.rotZ = p.rotZ;
      if (p.speed !== undefined) rp.speed = p.speed;
      if (p.score !== undefined) rp.score = p.score;
      rp.lastUpdate = performance.now();
    }
    return rp;
  }

  private notifyPlayerCount(): void {
    const total = this.remotePlayers.size + (this.isConnected ? 1 : 0);
    if (this.events.onPlayerCountChange) {
      this.events.onPlayerCountChange(total);
    }
  }

  public sendUpdate(stage: number, marble: MarbleState, score: number): void {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const now = performance.now();
    if (now - this.lastSendTime < this.SEND_INTERVAL) return;
    this.lastSendTime = now;

    this.ws.send(
      JSON.stringify({
        type: 'update',
        stage,
        intelligence: this.localIntelligence,
        x: Number(marble.x.toFixed(3)),
        y: Number(marble.y.toFixed(3)),
        z: Number(marble.z.toFixed(3)),
        vx: Number(marble.vx.toFixed(3)),
        vy: Number(marble.vy.toFixed(3)),
        vz: Number(marble.vz.toFixed(3)),
        rotX: Number(marble.rotX.toFixed(3)),
        rotZ: Number(marble.rotZ.toFixed(3)),
        speed: Number(marble.speed.toFixed(3)),
        score,
      }),
    );
  }

  public checkPlayerCollisions(
    currentStage: number,
    localMarble: MarbleState,
    onBump: (target: RemotePlayer, force: number) => void,
  ): void {
    const now = performance.now();
    const hitRadius = MABLE_R * 2.1; // Distance where spheres touch

    for (const remote of this.remotePlayers.values()) {
      // Only collide if on the same level stage
      if (remote.stage !== currentStage) continue;

      const dx = remote.x - localMarble.x;
      const dy = remote.y - localMarble.y;
      const dz = remote.z - localMarble.z;
      const dist = Math.hypot(dx, dy, dz);

      if (dist < hitRadius && dist > 0.001) {
        // Check cooldown against this specific player (prevent spam)
        const lastBump = this.bumpCooldown.get(remote.id) ?? 0;
        if (now - lastBump < 600) continue;
        this.bumpCooldown.set(remote.id, now);

        // Calculate collision normal
        const nx = dx / dist;
        const nz = dz / dist;

        const bumpForce = Math.max(0.2, Math.min(0.7, localMarble.speed * 1.5 + 0.25));

        // Elastic impulse: knock local marble back
        localMarble.vx -= nx * bumpForce * 0.7;
        localMarble.vz -= nz * bumpForce * 0.7;

        // Send bump command to server with impulse vector for the remote player
        const targetImpulseX = nx * bumpForce * 1.3;
        const targetImpulseZ = nz * bumpForce * 1.3;
        const targetImpulseY = 0.22; // Kick upwards off balance!

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(
            JSON.stringify({
              type: 'bump',
              targetId: remote.id,
              impulseX: Number(targetImpulseX.toFixed(3)),
              impulseY: Number(targetImpulseY.toFixed(3)),
              impulseZ: Number(targetImpulseZ.toFixed(3)),
              x: Number(remote.x.toFixed(3)),
              y: Number(remote.y.toFixed(3)),
              z: Number(remote.z.toFixed(3)),
            }),
          );
        }

        // Trigger local callback for scoring & effects
        onBump(remote, bumpForce);
      }
    }
  }

  public updateInterpolation(dt: number): void {
    // Smoothly interpolate remote players toward their target positions with dead-reckoning
    const lerpRate = Math.min(1, dt * 18);

    for (const rp of this.remotePlayers.values()) {
      // Dead-reckoning: predict intermediate frame motion from velocity
      rp.targetX += rp.vx * dt * 0.35;
      rp.targetY += rp.vy * dt * 0.35;
      rp.targetZ += rp.vz * dt * 0.35;

      rp.x += (rp.targetX - rp.x) * lerpRate;
      rp.y += (rp.targetY - rp.y) * lerpRate;
      rp.z += (rp.targetZ - rp.z) * lerpRate;

      // Update rolling angles based on velocity
      rp.rotX += rp.vz * 2.8;
      rp.rotZ -= rp.vx * 2.8;
    }
  }

  public getOnlinePlayers(): RemotePlayer[] {
    return Array.from(this.remotePlayers.values());
  }
}
