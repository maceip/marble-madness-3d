/**
 * Lobby networking. One WebSocket per page; the server relays marble state within a lobby.
 *   role 'human' | 'ai'  → Player-vs-AI lobby identified by UUID
 *   role 'multi'         → legacy shared world (lobby 'world')
 */
export type NetRole = 'human' | 'ai' | 'multi';

export interface RemoteState {
  id: string; role: NetRole; name: string; color: string;
  stage: number; u: number; v: number; z: number; vu: number; vv: number;
  phase: string; score: number; time: number; progress: number;
  /** 1 once the player has reached the goal of `stage` */
  fin?: number; deaths?: number;
}

export interface RemotePlayer extends RemoteState {
  /** interpolation targets */
  tu: number; tv: number; tz: number;
  lastSeen: number;
}

export class Net {
  ws: WebSocket | null = null;
  id = '';
  lobby = '';
  role: NetRole = 'human';
  players = new Map<string, RemotePlayer>();
  connected = false;
  private sendAcc = 0;
  private reconnectT: number | null = null;
  private wantName = '';

  onJoined?: (p: { id: string; role: NetRole; name: string }) => void;
  onLeft?: (p: { id: string; role: NetRole; name: string }) => void;
  onStart?: (stage: number, by: string) => void;
  onBump?: (iu: number, iv: number, from: string) => void;
  onLeaderboard?: (top: { name: string; score: number }[]) => void;

  connect(lobby: string, role: NetRole, name: string): void {
    this.lobby = lobby; this.role = role; this.wantName = name;
    this.close();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws?lobby=${encodeURIComponent(lobby)}&role=${role}`;
    try { this.ws = new WebSocket(url); } catch { this.scheduleReconnect(); return; }
    this.ws.onopen = () => {
      this.connected = true;
      this.send({ type: 'join', lobby, role, name });
    };
    this.ws.onmessage = (ev) => this.handle(JSON.parse(String(ev.data)));
    this.ws.onclose = () => { this.connected = false; this.players.clear(); this.scheduleReconnect(); };
    this.ws.onerror = () => { /* onclose follows */ };
  }

  private scheduleReconnect(): void {
    if (this.reconnectT !== null || !this.lobby) return;
    this.reconnectT = window.setTimeout(() => { this.reconnectT = null; this.connect(this.lobby, this.role, this.wantName); }, 3000);
  }

  close(): void {
    if (this.reconnectT !== null) { clearTimeout(this.reconnectT); this.reconnectT = null; }
    if (this.ws) { const w = this.ws; this.ws = null; w.onclose = null; try { w.close(); } catch { /* */ } }
    this.connected = false;
    this.players.clear();
  }

  /** disconnect for good (leaving the lobby) */
  leave(): void { this.lobby = ''; this.close(); }

  private handle(m: Record<string, unknown>): void {
    switch (m.type) {
      case 'welcome':
        this.id = String(m.id);
        for (const p of (m.players as RemoteState[]) ?? []) this.upsert(p);
        break;
      case 'joined': {
        const p = { id: String(m.id), role: m.role as NetRole, name: String(m.name) };
        this.onJoined?.(p);
        break;
      }
      case 'left': {
        const id = String(m.id);
        this.players.delete(id);
        this.onLeft?.({ id, role: m.role as NetRole, name: String(m.name) });
        break;
      }
      case 'tick': {
        const seen = new Set<string>();
        for (const p of (m.players as RemoteState[]) ?? []) {
          if (p.id === this.id) continue;
          seen.add(p.id);
          this.upsert(p);
        }
        for (const id of [...this.players.keys()]) if (!seen.has(id)) this.players.delete(id);
        break;
      }
      case 'start': this.onStart?.(Number(m.stage) || 1, String(m.by)); break;
      case 'bump': this.onBump?.(Number(m.iu) || 0, Number(m.iv) || 0, String(m.from)); break;
      case 'leaderboard': this.onLeaderboard?.((m.top50 as { name: string; score: number }[]) ?? []); break;
    }
  }

  private upsert(p: RemoteState): void {
    const cur = this.players.get(p.id);
    if (cur) {
      Object.assign(cur, p, { tu: p.u, tv: p.v, tz: p.z, lastSeen: performance.now() });
    } else {
      this.players.set(p.id, { ...p, tu: p.u, tv: p.v, tz: p.z, lastSeen: performance.now() });
    }
  }

  /** smooth remote marbles toward their latest state */
  update(dt: number): void {
    for (const p of this.players.values()) {
      p.tu += p.vu * dt * 0.5; p.tv += p.vv * dt * 0.5;
      const k = Math.min(1, dt * 14);
      p.u += (p.tu - p.u) * k; p.v += (p.tv - p.v) * k; p.z += (p.tz - p.z) * k;
    }
  }

  send(obj: unknown): void {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  /** ≤ 30 Hz state broadcast */
  sendState(dt: number, s: Omit<RemoteState, 'id' | 'role' | 'name' | 'color'>): void {
    this.sendAcc += dt;
    if (this.sendAcc < 1 / 30) return;
    this.sendAcc = 0;
    this.send({ type: 'state', ...s, u: +s.u.toFixed(3), v: +s.v.toFixed(3), z: +s.z.toFixed(1), vu: +s.vu.toFixed(2), vv: +s.vv.toFixed(2) });
  }

  sendStart(stage: number): void { this.send({ type: 'start', stage }); }
  sendBump(targetId: string, iu: number, iv: number): void { this.send({ type: 'bump', targetId, iu, iv }); }

  /** the first remote player with the given role (2P lobbies have exactly one opponent) */
  opponent(role?: NetRole): RemotePlayer | undefined {
    for (const p of this.players.values()) if (!role || p.role === role) return p;
    return undefined;
  }
}
