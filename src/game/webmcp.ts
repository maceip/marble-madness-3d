import type { Game } from './game';
import { mmTrace } from '../engine/trace';
import { STAGES } from '../levels';
import { topAt } from '../engine/level';

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
  // newer WebMCP surface: register everything in one call (Codex builds may expose this instead of registerTool)
  provideContext?(ctx: { tools?: ToolDef[]; resources?: ResourceDef[] }): void;
  registerPrompt?(prompt: unknown): void;
}

/** MCP CallToolResult shape: agents expect { content:[{type:'text',text}] }, with structuredContent for machines. */
function toToolResult(out: unknown): { content: { type: 'text'; text: string }[]; structuredContent: Record<string, unknown>; isError?: boolean } {
  const text = typeof out === 'string' ? out : JSON.stringify(out);
  const structured = (out && typeof out === 'object') ? (out as Record<string, unknown>) : { value: out };
  const isError = !!(out && typeof out === 'object' && (out as Record<string, unknown>).ok === false);
  return isError ? { content: [{ type: 'text', text }], structuredContent: structured, isError } : { content: [{ type: 'text', text }], structuredContent: structured };
}

export class WebMCP {
  tools: ToolDef[];
  resources: ResourceDef[];
  used = false;
  private subscribers = new Set<(event: string, data: unknown) => void>();
  private eventWaiters: Array<(e: { event: string; data: unknown }) => void> = [];
  lastEvent: { event: string; data: unknown } | null = null;

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
        name: 'get_game_state',
        description: 'Read the full game state: race stage, timer, score, marble position, velocity, trackball angular speed, terrain, and opponent position.',
        inputSchema: { type: 'object', properties: {} },
        execute: () => this.state(),
      },
      {
        name: 'wait_for_tick',
        description: 'Wait briefly, then return a fresh game-state snapshot. Use wait_for_race_event for discrete race events.',
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
        name: 'set_name',
        description: 'Set the display name the human sees for you (the AI marble) during the race and on the leaderboard. Call this once when you join, before the race starts.',
        inputSchema: { type: 'object', properties: { name: { type: 'string', maxLength: 10, description: 'Your display name, e.g. "GPT-5" or "CODEX"' } }, required: ['name'] },
        execute: (a) => {
          const g = this.game;
          this.mark();
          const nm = String(a.name ?? 'AGENT').toUpperCase().replace(/[^A-Z0-9 \[\]]/g, '').trim().slice(0, 10) || 'AGENT';
          g.playerName = nm; g.isAI = true;
          const announced = g.net.setName(nm); // otherwise queued and sent by Net.onopen
          return { ok: true, name: nm, delivery: announced ? 'announced' : 'queued_until_connected' };
        },
      },
      {
        name: 'wait_for_race_event',
        description: 'Block until the next race event (race_start, death, checkpoint, goal, race_end, share_candidate) or the timeout, then return that event plus the full game state. A share_candidate asks you to inspect a recorded 2P race and decide whether/where to clip it. Use this instead of polling get_game_state in a loop.',
        inputSchema: { type: 'object', properties: { timeout_ms: { type: 'number', minimum: 20, maximum: 5000, default: 2000 } } },
        execute: (a) => this.waitForEvent(Number(a.timeout_ms ?? 2000)),
      },
      {
        name: 'get_share_candidate',
        description: 'Inspect the current 2P race recording candidate. When ready, open previewUrl and decide whether it contains a magic moment and the exact clip window.',
        inputSchema: { type: 'object', properties: {} },
        execute: () => this.game.magicRecorder.review(),
      },
      {
        name: 'share',
        description: 'Review a completed 2P race recording. Decline it, or render a 0.5-8 second GIF whose first frame says Marble Madness: Humans vs Agents and whose share card links to the app. This prepares a card/link; it never posts to an external account without the user.',
        inputSchema: {
          type: 'object',
          properties: {
            worthSharing: { type: 'boolean', description: 'True only if the preview has a knockout, griefing, comic failure, comeback, or close finish worth clipping.' },
            start: { type: 'number', minimum: 0, description: 'Clip start in seconds from the preview.' },
            end: { type: 'number', minimum: 0.5, description: 'Clip end, no more than 8 seconds after start.' },
            where: { type: 'string', maxLength: 40, description: 'Intended destination, e.g. copy link, X, Bluesky, Discord.' },
            caption: { type: 'string', maxLength: 240, description: 'Optional caption displayed on the share card.' },
          },
          required: ['worthSharing'],
        },
        execute: (a) => this.game.magicRecorder.share(a),
      },
      {
        name: 'submit_leaderboard_score',
        description: 'Submit the final score to High Rollers tagged as AI. Optional initials also set your name; prefer set_name at the start.',
        inputSchema: { type: 'object', properties: { initials: { type: 'string', maxLength: 10 } } },
        execute: async (a) => {
          const g = this.game;
          if (a.initials) g.playerName = String(a.initials).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || g.playerName || 'AI';
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

  private traffic(phase: 'call' | 'result' | 'error' | 'event' | 'resource', name: string, payload: unknown = {}): void {
    window.dispatchEvent(new CustomEvent('mm:mcp-traffic', { detail: { phase, name, payload, at: performance.now() } }));
  }

  /** fire a race event: wakes any wait_for_race_event callers and window.webmcp.subscribe listeners */
  emit(event: string, data: unknown = {}): void {
    this.lastEvent = { event, data };
    this.traffic('event', event, data);
    const waiters = this.eventWaiters; this.eventWaiters = [];
    for (const w of waiters) { try { w({ event, data }); } catch (e) { console.warn('[webmcp] waiter error', e); } }
    for (const sub of this.subscribers) { try { sub(event, data); } catch (e) { console.warn('[webmcp] subscriber error', e); } }
  }
  /** @deprecated kept for the window.webmcp mirror; use emit() */
  notifySubscribers(event: string, data: unknown): void { this.emit(event, data); }

  private waitForEvent(timeoutMs: number): Promise<unknown> {
    this.mark();
    const ms = Number.isFinite(timeoutMs) ? Math.max(20, Math.min(5000, timeoutMs)) : 2000;
    return new Promise((resolve) => {
      let done = false;
      const waiter = (e: { event: string; data: unknown }) => finish(e.event, e.data);
      const finish = (evt: string, data: unknown) => {
        if (done) return;
        done = true; clearTimeout(to);
        const i = this.eventWaiters.indexOf(waiter);
        if (i >= 0) this.eventWaiters.splice(i, 1);
        resolve({ event: evt, data, state: this.state() });
      };
      const to = setTimeout(() => finish('timeout', null), ms);
      this.eventWaiters.push(waiter);
    });
  }

  private register(): void {
    const w = window as unknown as { webmcp?: unknown };
    const surfaces = new Set<ModelContext>();
    const nav = navigator as unknown as { modelContext?: ModelContext };
    const doc = document as unknown as { modelContext?: ModelContext };
    if (nav.modelContext?.registerTool || nav.modelContext?.provideContext) surfaces.add(nav.modelContext);
    if (doc.modelContext?.registerTool || doc.modelContext?.provideContext) surfaces.add(doc.modelContext);

    // wrap each tool: trace it AND return the MCP CallToolResult shape ({content, structuredContent}) agents expect
    const traced: ToolDef[] = this.tools.map((t) => ({ ...t, execute: async (args: Record<string, unknown>) => {
      this.traffic('call', t.name, args);
      mmTrace('webmcp.call', { tool: t.name, args, screen: this.game.screen });
      try {
        const out = await t.execute(args ?? {});
        mmTrace('webmcp.done', { tool: t.name, screen: this.game.screen, out: (out && typeof out === 'object') ? out : { v: out } });
        this.traffic('result', t.name, out);
        return toToolResult(out);
      } catch (error) {
        this.traffic('error', t.name, { message: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    } }));
    for (const s of surfaces) {
      try {
        if (typeof s.provideContext === 'function') {
          s.provideContext({ tools: traced, resources: this.resources });   // newer one-shot WebMCP surface
        } else {
          for (const t of traced) s.registerTool?.(t);
          for (const r of this.resources) s.registerResource?.(r);
        }
      } catch (e) { console.warn('[webmcp] register failed', e); }
    }

    w.webmcp = {
      listTools: () => this.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      callTool: async (name: string, args: Record<string, unknown> = {}) => {
        const t = this.tools.find((x) => x.name === name);
        if (!t) { mmTrace('webmcp.unknown', { name }); this.traffic('error', name, { message: 'unknown tool' }); throw new Error(`unknown tool ${name}`); }
        this.traffic('call', name, args);
        mmTrace('webmcp.call', { tool: name, args, screen: this.game.screen });
        try {
          const out = await t.execute(args ?? {});
          mmTrace('webmcp.done', { tool: name, screen: this.game.screen, out: (out && typeof out === 'object') ? out : { v: out } });
          this.traffic('result', name, out);
          return out;
        } catch (error) {
          this.traffic('error', name, { message: error instanceof Error ? error.message : String(error) });
          throw error;
        }
      },
      listResources: () => this.resources,
      readResource: async (uri: string) => {
        this.traffic('resource', uri);
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
        raceOver: g.finished || ['timebonus', 'gameover', 'congrats', 'rematch'].includes(g.screen),
        finalScore: g.score,
      },
      lastEvent: this.lastEvent ? this.lastEvent.event : null,
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
    const point = (u: number, v: number) => {
      const floor = topAt(g.stage, u, v);
      const z = floor?.z ?? 0;
      return { x: Math.round((u - v) * 8), y: Math.round((u + v) * 4 - z), height: Math.round(z) };
    };
    const checkpoints = g.stage.checkpoints.map((p, index) => ({ index, ...point(p.u, p.v) }));
    const goalZone = g.stage.zones.find((z) => z.kind === 'goal');
    const goal = goalZone ? point((goalZone.u0 + goalZone.u1) / 2, (goalZone.v0 + goalZone.v1) / 2) : null;
    const nextCheckpoint = checkpoints[Math.min(g.checkpointIdx + 1, checkpoints.length - 1)] ?? goal;
    return {
      stage: g.stageIdx + 1, name: g.stage.name,
      width: g.stage.width, height: g.stage.height,
      progressDir: g.stage.progressDir > 0 ? 'descend (+y)' : 'ascend (-y)',
      timeAdd: g.stage.timeAdd,
      currentCheckpoint: g.checkpointIdx,
      nextTarget: nextCheckpoint ?? goal,
      route: [...checkpoints, ...(goal ? [{ index: checkpoints.length, ...goal, goal: true }] : [])],
      goal,
      zones: g.stage.zones.map((z) => ({ kind: z.kind, id: z.id })),
    };
  }

  private spin(dx: number, dy: number, speed: number): unknown {
    this.mark();
    const g = this.game;
    dx = Number.isFinite(dx) ? Math.max(-1, Math.min(1, dx)) : 0;
    dy = Number.isFinite(dy) ? Math.max(-1, Math.min(1, dy)) : 0;
    speed = Number.isFinite(speed) ? Math.max(1, Math.min(100, speed)) : 50;
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
      hint: 'No brakes on the cabinet. Counter-spin (reverse dx/dy) to slow down, or coast on friction.',
    };
  }

  private async waitForTick(timeoutMs: number): Promise<unknown> {
    this.mark();
    const ms = Number.isFinite(timeoutMs) ? Math.max(16, Math.min(1000, timeoutMs)) : 100;
    await new Promise((resolve) => setTimeout(resolve, ms));
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
      case 'title': g.go('menu'); g.sound.init(); return { ok: true, screen: g.screen };
      case 'menu': g.mode = g.mode === 'ai' ? 'ai' : '1p'; g.playerName = g.playerName || 'AGENT'; g.go('control'); return { ok: true, screen: g.screen };
      case 'name': g.playerName = g.playerName || 'AGENT'; g.go('control'); return { ok: true, screen: g.screen };
      case 'control':
        if (g.mode === 'ai' && g.net.lobby) { g.agentReady = true; return { ok: true, waitingForHuman: true }; }
        g.newGame(0); return { ok: true, screen: 'intro' };
      case 'connect': return { ok: true, waitingForHuman: true };
      case 'gameover': case 'congrats': g.go('title'); return { ok: true, screen: g.screen };
      case 'race':
        if (g.marble.phase === 'dead' || g.marble.phase === 'dying') return { ok: true, respawning: true };
        return { ok: true, screen: 'race', note: 'already racing' };
      default: return { ok: true, screen: g.screen, stages: STAGES.length };
    }
  }
}
