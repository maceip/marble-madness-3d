import type { Game } from './game';
import { STAGES } from '../levels';

/**
 * WebMCP surface for AI agents.
 * Models the original arcade machine: ONLY a physical optical trackball!
 * There are NO magic brakes or velocity setters. The agent must manage
 * angular momentum, friction, and counter-spinning (reverse swipes).
 *
 * Implements standard MCP Tools, Resources (game://state, game://course),
 * and Subscriptions for real-time race events.
 */
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

export interface ResourceDef {
  uri: string;
  name: string;
  mimeType: string;
  description: string;
}

interface ModelContext {
  registerTool?(tool: ToolDef): void;
  registerResource?(resource: ResourceDef): void;
}

const DIRS: Record<string, [number, number]> = {
  N: [0, -1], NE: [0.707, -0.707], E: [1, 0], SE: [0.707, 0.707],
  S: [0, 1], SW: [-0.707, 0.707], W: [-1, 0], NW: [-0.707, -0.707],
  UP: [0, -1], DOWN: [0, 1], LEFT: [-1, 0], RIGHT: [1, 0],
};

export class WebMCP {
  tools: ToolDef[];
  resources: ResourceDef[];
  used = false;
  private subscribers = new Set<(event: string, data: unknown) => void>();

  constructor(private game: Game) {
    this.resources = [
      {
        uri: 'game://state',
        name: 'Live Race State',
        mimeType: 'application/json',
        description: 'Current real-time position, velocity, trackball angular momentum, score, timer, and nearby hazards.',
      },
      {
        uri: 'game://course',
        name: 'Course & Terrain Spec',
        mimeType: 'application/json',
        description: 'Stage bounds, goal position, downhill vector, and known hazard placements for the current race.',
      },
    ];

    this.tools = [
      {
        name: 'spin_trackball',
        description: 'Swipe the physical arcade trackball. dx (-1.0 to 1.0, right), dy (-1.0 to 1.0, down), speed (1 to 100, intensity). The ball has angular mass and bearing friction. There are NO brakes: you must counter-spin (swipe in reverse) to slow down, or you will fly off cliffs!',
        inputSchema: {
          type: 'object',
          properties: {
            dx: { type: 'number', minimum: -1, maximum: 1, description: 'Horizontal swipe delta (-1 left, +1 right)' },
            dy: { type: 'number', minimum: -1, maximum: 1, description: 'Vertical swipe delta (-1 up, +1 down/descend)' },
            speed: { type: 'number', minimum: 1, maximum: 100, default: 50, description: 'How hard you swipe the ball (simulates optical encoder tick rate)' },
          },
          required: ['dx', 'dy'],
        },
        execute: (a) => this.spin(Number(a.dx ?? 0), Number(a.dy ?? 1), Number(a.speed ?? 50)),
      },
      {
        name: 'steer_trackball',
        description: 'Legacy directional trackball push. direction: N/NE/E/SE/S/SW/W/NW or degrees 0-360. Translates to physical trackball spin.',
        inputSchema: {
          type: 'object',
          properties: {
            direction: { type: 'string', description: 'N, NE, E, SE, S, SW, W, NW or degree angle' },
            impulse: { type: 'number', minimum: 0.1, maximum: 1, default: 0.7 },
          },
          required: ['direction'],
        },
        execute: (a) => this.steer(String(a.direction ?? 'S'), Number(a.impulse ?? 0.7)),
      },
      {
        name: 'apply_brake',
        description: 'Attempts to brake. In Marble Madness arcade, there are NO physical brakes on the cabinet! You must counter-spin the trackball.',
        inputSchema: { type: 'object', properties: {} },
        execute: () => ({
          ok: false,
          warning: 'The arcade cabinet has NO brakes! To stop or slow down, you must counter-spin the trackball in reverse (spin_trackball with opposing vector) or let surface friction decelerate you.',
        }),
      },
      {
        name: 'get_game_state',
        description: 'Read the full game state: race stage, timer, score, marble position, velocity, trackball angular speed, terrain, and opponent position.',
        inputSchema: { type: 'object', properties: {} },
        execute: () => this.state(),
      },
      {
        name: 'wait_for_tick',
        description: 'Wait for next physics tick or race event (landing, bump, checkpoint, or void drop). Prevents blind polling loops.',
        inputSchema: {
          type: 'object',
          properties: { timeout_ms: { type: 'number', minimum: 20, maximum: 1000, default: 100 } },
        },
        execute: (a) => this.waitForTick(Number(a.timeout_ms ?? 100)),
      },
      {
        name: 'start_or_respawn',
        description: 'Advance from a menu screen into a race, or start a new game after game over. If you opened a lobby URL you are the AI player: the human starts every race and rematch from their device; this only reports that you are waiting. Nobody needs to type or click anything.',
        inputSchema: { type: 'object', properties: {} },
        execute: () => this.startOrRespawn(),
      },
      {
        name: 'submit_leaderboard_score',
        description: 'Submit the final score to High Rollers tagged as AI.',
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

  notifySubscribers(event: string, data: unknown): void {
    for (const sub of this.subscribers) {
      try { sub(event, data); } catch (e) { console.warn('[webmcp] subscriber error', e); }
    }
  }

  private register(): void {
    const w = window as unknown as { webmcp?: unknown };
    const surfaces: ModelContext[] = [];
    const nav = navigator as unknown as { modelContext?: ModelContext };
    const doc = document as unknown as { modelContext?: ModelContext };
    if (nav.modelContext?.registerTool) surfaces.push(nav.modelContext);
    if (doc.modelContext?.registerTool) surfaces.push(doc.modelContext);

    for (const s of surfaces) {
      for (const t of this.tools) {
        try { s.registerTool?.(t); } catch (e) { console.warn('[webmcp] tool register failed', t.name, e); }
      }
      for (const r of this.resources) {
        try { s.registerResource?.(r); } catch (e) { console.warn('[webmcp] resource register failed', r.uri, e); }
      }
    }

    w.webmcp = {
      listTools: () => this.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      callTool: async (name: string, args: Record<string, unknown> = {}) => {
        const t = this.tools.find((x) => x.name === name);
        if (!t) throw new Error(`unknown tool ${name}`);
        return t.execute(args ?? {});
      },
      listResources: () => this.resources,
      readResource: async (uri: string) => {
        if (uri === 'game://state') return { contents: [ { uri, mimeType: 'application/json', text: JSON.stringify(this.state()) } ] };
        if (uri === 'game://course') return { contents: [ { uri, mimeType: 'application/json', text: JSON.stringify(this.course()) } ] };
        throw new Error(`unknown resource ${uri}`);
      },
      subscribe: (callback: (event: string, data: unknown) => void) => {
        this.subscribers.add(callback);
        return () => this.subscribers.delete(callback);
      },
    };
    console.log(`[webmcp] ${this.tools.length} tools & ${this.resources.length} resources registered`);
  }

  state(): unknown {
    const g = this.game; const m = g.marble;
    const mx = (m.u - m.v) * 8, my = (m.u + m.v) * 4 - m.z;
    const opp = g.others[0];
    const tb = g.input.trackball;
    const tbSpeed = Math.hypot(tb.wx, tb.wy);

    return {
      screen: g.screen, mode: g.mode, lobby: g.lobbyId || null, agentJoined: g.agentJoined,
      race: {
        stage: g.stageIdx + 1, name: g.stage.name,
        direction: g.stage.progressDir > 0 ? 'descend (+y)' : 'ascend (-y)',
        timeLeft: Math.round(g.timeLeft * 10) / 10, score: g.score, deaths: g.deaths,
        controlsReversed: !!g.stage.reverseControls, finished: g.finished,
        opponentFinished: g.oppFinished, wonLastRace: g.wonLast,
      },
      trackball: {
        angularSpeedRpm: Math.round(tbSpeed * 9.55),
        headingDeg: Math.round(((Math.atan2(tb.wx, tb.wy) * 180 / Math.PI) + 360) % 360),
      },
      marble: {
        x: Math.round(mx), y: Math.round(my), height: Math.round(m.z),
        vx: Math.round((m.vu - m.vv) * 8), vy: Math.round((m.vu + m.vv) * 4),
        speed: +m.speed.toFixed(2), grounded: m.grounded, phase: m.phase,
        dizzy: m.dizzyT > 0, inPipe: m.inPipe, ridingStartRamp: !!m.slide,
        supportedBy: m.support ? m.support.s.name ?? 'floor' : null,
      },
      opponent: opp ? { x: Math.round((opp.u - opp.v) * 8), y: Math.round((opp.u + opp.v) * 4 - opp.z), phase: opp.phase } : null,
      hazardsCount: g.hazards.length,
      hint: 'The arcade trackball has physical inertia. To brake, counter-spin in reverse. Watch out for cliffs!',
    };
  }

  course(): unknown {
    const g = this.game;
    return {
      stage: g.stageIdx + 1, name: g.stage.name,
      width: g.stage.width, height: g.stage.height,
      progressDir: g.stage.progressDir > 0 ? 'descend (+y)' : 'ascend (-y)',
      timeAdd: g.stage.timeAdd,
      zones: g.stage.zones.map((z) => ({ kind: z.kind, id: z.id })),
    };
  }

  private spin(dx: number, dy: number, speed: number): unknown {
    this.mark();
    const g = this.game;
    g.input.trackball.spin(dx, dy, speed);
    
    // Immediate physical feedback
    const m = g.marble;
    const tb = g.input.trackball;
    return {
      ok: true,
      trackball: {
        rpm: Math.round(Math.hypot(tb.wx, tb.wy) * 9.55),
        spinVector: { dx: +dx.toFixed(2), dy: +dy.toFixed(2) },
      },
      marble: {
        speed: +m.speed.toFixed(2),
        grounded: m.grounded,
        phase: m.phase,
        warning: !m.grounded ? 'Airborne! In danger of shattering on impact!' : null,
      },
    };
  }

  private steer(direction: string, impulse: number): unknown {
    this.mark();
    let dx = 0, dy = 1;
    const d = DIRS[direction.toUpperCase()];
    if (d) {
      dx = d[0]; dy = d[1];
    } else {
      const deg = Number(direction);
      if (Number.isFinite(deg)) {
        dx = Math.cos(deg * Math.PI / 180);
        dy = Math.sin(deg * Math.PI / 180);
      }
    }
    return this.spin(dx, dy, impulse * 80);
  }

  private async waitForTick(timeoutMs: number): Promise<unknown> {
    this.mark();
    await new Promise((resolve) => setTimeout(resolve, Math.max(16, Math.min(1000, timeoutMs))));
    return this.state();
  }

  private startOrRespawn(): unknown {
    const g = this.game;
    this.mark();
    if (g.isAgentPage) {
      // the human starts every race from their side; the agent never walks the human's menus
      if (g.screen === 'race') return { ok: true, screen: 'race', respawning: g.marble.phase === 'dead' || g.marble.phase === 'dying' };
      if (g.screen === 'intro') return { ok: true, screen: 'intro', note: 'race starting' };
      if (g.screen === 'gameover' || g.screen === 'congrats' || g.screen === 'timebonus') { g.go('connect'); }
      return { ok: true, waitingForHuman: true, screen: g.screen, note: 'connected to the lobby; the human starts the race, nothing to do until then' };
    }
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
