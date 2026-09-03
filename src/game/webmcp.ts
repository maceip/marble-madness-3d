import type { Game } from './game';
import { STAGES } from '../levels';

/**
 * WebMCP surface for AI agents. Registers tools on navigator.modelContext /
 * document.modelContext when available and always exposes window.webmcp as a fallback.
 * Steering uses the same trackball-style input as a human: an impulse in a screen
 * direction for a short duration, so agents must manage momentum.
 */
interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

interface ModelContext { registerTool(tool: ToolDef): void }

const DIRS: Record<string, [number, number]> = {
  N: [0, -1], NE: [1, -1], E: [1, 0], SE: [1, 1], S: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [-1, -1],
  UP: [0, -1], DOWN: [0, 1], LEFT: [-1, 0], RIGHT: [1, 0],
};

export class WebMCP {
  tools: ToolDef[];
  used = false;

  constructor(private game: Game) {
    this.tools = [
      {
        name: 'get_game_state',
        description: 'Marble Madness: current screen, race, timer, score and the marble\'s position/velocity in map pixels (x right, y down), plus the opponent marble if any. Call this every few hundred ms while racing. The course descends toward larger y (except the Silly Race which ascends).',
        inputSchema: { type: 'object', properties: {} },
        execute: () => this.state(),
      },
      {
        name: 'steer_trackball',
        description: 'Push the trackball. direction: N/NE/E/SE/S/SW/W/NW (screen directions, S = down the screen) or degrees 0-360 (0 = right, 90 = down). impulse 0.1-1.0, duration_ms 50-600. Momentum carries: short pushes and counter-steering are needed near edges.',
        inputSchema: {
          type: 'object',
          properties: {
            direction: { type: 'string', description: 'N, NE, E, SE, S, SW, W, NW or a number of degrees' },
            impulse: { type: 'number', minimum: 0.1, maximum: 1, default: 0.7 },
            duration_ms: { type: 'number', minimum: 50, maximum: 600, default: 200 },
          },
          required: ['direction'],
        },
        execute: (a) => this.steer(String(a.direction ?? 'S'), Number(a.impulse ?? 0.7), Number(a.duration_ms ?? 200)),
      },
      {
        name: 'apply_brake',
        description: 'Stop pushing and let friction slow the marble for duration_ms (50-800). Use before edges and turns.',
        inputSchema: { type: 'object', properties: { duration_ms: { type: 'number', minimum: 50, maximum: 800, default: 250 } } },
        execute: (a) => { this.mark(); this.game.input.setAI(0, 0, Number(a.duration_ms ?? 250)); return { ok: true }; },
      },
      {
        name: 'start_or_respawn',
        description: 'Advance from any menu screen (title, menu, name entry) into a race, or start a new game after game over. In a Player-vs-AI lobby the human starts the race; this just confirms you are ready.',
        inputSchema: { type: 'object', properties: {} },
        execute: () => this.startOrRespawn(),
      },
      {
        name: 'submit_leaderboard_score',
        description: 'Submit the current score to the High Rollers leaderboard under a 1-6 letter name (tagged as AI).',
        inputSchema: { type: 'object', properties: { initials: { type: 'string', maxLength: 6 } }, required: ['initials'] },
        execute: async (a) => {
          const g = this.game;
          g.playerName = String(a.initials ?? 'AI').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'AI';
          g.isAI = true; g.scoreSubmitted = false;
          await g.submitScore();
          return { ok: true, name: g.playerName, score: g.score };
        },
      },
    ];
    this.register();
  }

  private mark(): void {
    if (!this.used) { this.used = true; this.game.isAI = true; this.game.onAgentDetected?.(); }
  }

  private register(): void {
    const w = window as unknown as { webmcp?: unknown };
    const surfaces: ModelContext[] = [];
    const nav = navigator as unknown as { modelContext?: ModelContext };
    const doc = document as unknown as { modelContext?: ModelContext };
    if (nav.modelContext?.registerTool) surfaces.push(nav.modelContext);
    if (doc.modelContext?.registerTool) surfaces.push(doc.modelContext);
    for (const s of surfaces) for (const t of this.tools) { try { s.registerTool(t); } catch (e) { console.warn('[webmcp] register failed', t.name, e); } }
    w.webmcp = {
      listTools: () => this.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      callTool: async (name: string, args: Record<string, unknown> = {}) => {
        const t = this.tools.find((x) => x.name === name);
        if (!t) throw new Error(`unknown tool ${name}`);
        return t.execute(args ?? {});
      },
    };
    console.log(`[webmcp] ${this.tools.length} tools registered (${surfaces.length} modelContext surface(s), window.webmcp fallback)`);
  }

  state(): unknown {
    const g = this.game; const m = g.marble;
    const mx = (m.u - m.v) * 8, my = (m.u + m.v) * 4 - m.z;
    const opp = g.others[0];
    return {
      screen: g.screen, mode: g.mode, lobby: g.lobbyId || null, agentJoined: g.agentJoined,
      race: { stage: g.stageIdx + 1, name: g.stage.name, direction: g.stage.progressDir > 0 ? 'descend (+y)' : 'ascend (-y)', timeLeft: Math.round(g.timeLeft * 10) / 10, score: g.score, deaths: g.deaths },
      marble: {
        x: Math.round(mx), y: Math.round(my), height: Math.round(m.z), vx: Math.round((m.vu - m.vv) * 8), vy: Math.round((m.vu + m.vv) * 4),
        speed: +m.speed.toFixed(2), grounded: m.grounded, phase: m.phase, dizzy: m.dizzyT > 0, frozen: m.frozenT > 0, inPipe: m.inPipe,
        supportedBy: m.support ? m.support.s.name ?? 'floor' : null,
      },
      opponent: opp ? { x: Math.round((opp.u - opp.v) * 8), y: Math.round((opp.u + opp.v) * 4 - opp.z), phase: opp.phase } : null,
      camera: { y: Math.round(g.r.cam.y), viewHeight: 240 },
      hint: 'y increases down the screen; hold S to roll down the course, use E/W to line up with ramps. Avoid dark voids; walls bounce you.',
    };
  }

  private steer(direction: string, impulse: number, duration: number): unknown {
    this.mark();
    let ax = 0, ay = 0;
    const d = DIRS[direction.toUpperCase()];
    if (d) { ax = d[0]; ay = d[1]; }
    else { const deg = Number(direction); if (Number.isFinite(deg)) { ax = Math.cos(deg * Math.PI / 180); ay = Math.sin(deg * Math.PI / 180); } else { ay = 1; } }
    const m = Math.hypot(ax, ay) || 1;
    const k = Math.max(0.1, Math.min(1, impulse));
    this.game.input.setAI((ax / m) * k, (ay / m) * k, Math.max(50, Math.min(600, duration)));
    return { ok: true, direction, impulse: k, duration_ms: duration };
  }

  private startOrRespawn(): unknown {
    const g = this.game;
    this.mark();
    switch (g.screen) {
      case 'highrollers': case 'title': g.go('menu'); g.sound.init(); return { ok: true, screen: g.screen };
      case 'menu': g.mode = g.mode === 'ai' ? 'ai' : '1p'; g.playerName = g.playerName || 'AGENT'; g.go('control'); return { ok: true, screen: g.screen };
      case 'name': g.playerName = g.playerName || 'AGENT'; g.go('control'); return { ok: true, screen: g.screen };
      case 'control':
        if (g.mode === 'ai' && g.net.lobby) { g.agentReady = true; return { ok: true, waitingForHuman: true }; }
        g.newGame(0); return { ok: true, screen: 'intro' };
      case 'connect': return { ok: true, waitingForHuman: true };
      case 'gameover': case 'congrats': g.go('highrollers'); return { ok: true, screen: g.screen };
      case 'race':
        if (g.marble.phase === 'dead' || g.marble.phase === 'dying') return { ok: true, respawning: true };
        return { ok: true, screen: 'race', note: 'already racing' };
      default: return { ok: true, screen: g.screen, stages: STAGES.length };
    }
  }
}
