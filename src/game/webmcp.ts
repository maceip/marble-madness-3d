import type { Game } from './game';
import { mmTrace } from '../engine/trace';
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
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
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

const RACE_EVENTS = ['race_start', 'death', 'checkpoint', 'goal', 'race_end', 'share_candidate', 'share_error'] as const;
type RaceEventName = typeof RACE_EVENTS[number];
interface RaceEventRecord { sequence: number; event: string; data: unknown; at: number }
interface EventWaiter {
  afterSequence: number;
  events: Set<string> | null;
  finish: (event: RaceEventRecord) => void;
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
  private eventWaiters: EventWaiter[] = [];
  private eventSequence = 0;
  private eventLog: RaceEventRecord[] = [];
  lastEvent: RaceEventRecord | null = null;

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
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        execute: (a) => this.spin(Number(a.dx ?? 0), Number(a.dy ?? 1), Number(a.speed ?? 50)),
      },
      {
        name: 'get_game_state',
        description: 'Read the full game state: race stage, timer, score, marble position, velocity, trackball angular speed, terrain, and opponent position.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, openWorldHint: false },
        execute: () => this.state(),
      },
      {
        name: 'get_course',
        description: 'Read the current stage route, checkpoints, next target, goal, bounds, direction, and hazard-zone kinds before choosing trackball moves.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, openWorldHint: false },
        execute: () => this.course(),
      },
      {
        name: 'wait_for_tick',
        description: 'Wait briefly, then return a fresh game-state snapshot. Use wait_for_race_event for discrete race events.',
        inputSchema: {
          type: 'object',
          properties: { timeout_ms: { type: 'number', minimum: 20, maximum: 1000, default: 100 } },
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
        execute: (a) => this.waitForTick(Number(a.timeout_ms ?? 100)),
      },
      {
        name: 'get_lobby_status',
        description: 'Read whether the agent is connected, waiting for the human, starting, racing, or automatically respawning. Opening the lobby URL joins Player 2 automatically; the human starts races and rematches.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, openWorldHint: false },
        execute: () => this.lobbyStatus(),
      },
      {
        name: 'set_name',
        description: 'Set the display name the human sees for the AI marble. This can be your agent or model name. Call it immediately after opening the lobby; if the socket is still connecting, the name is queued safely.',
        inputSchema: { type: 'object', properties: { name: { type: 'string', maxLength: 10, description: 'Agent or model display name, e.g. "SOL" or "CODEX"' } }, required: ['name'], additionalProperties: false },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
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
        description: 'Wait for a matching race event and return its sequence plus full state. Filter with events so a delayed share_candidate cannot consume a race_start wait. To recover an event that arrived between calls, pass after_sequence from get_game_state or the previous event. After death, keep waiting: respawn is automatic. After race_end, wait for the human\'s next race_start rematch.',
        inputSchema: {
          type: 'object',
          properties: {
            timeout_ms: { type: 'number', minimum: 20, maximum: 5000, default: 2000 },
            events: { type: 'array', items: { type: 'string', enum: RACE_EVENTS }, minItems: 1, uniqueItems: true, description: 'Optional event names to wait for.' },
            after_sequence: { type: 'integer', minimum: 0, description: 'Replay the first matching buffered event newer than this sequence.' },
          },
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
        execute: (a) => this.waitForEvent(Number(a.timeout_ms ?? 2000), a.events, a.after_sequence),
      },
      {
        name: 'get_share_candidate',
        description: 'Inspect the latest 2P race recording candidate, or a specific candidate from a share_candidate event. When ready, open previewUrl and decide whether it contains a magic moment and the exact clip window.',
        inputSchema: { type: 'object', properties: { candidateId: { type: 'string', description: 'Optional candidate ID from a share_candidate event, useful when races rematch rapidly.' } }, additionalProperties: false },
        annotations: { readOnlyHint: true, openWorldHint: false },
        execute: (a) => this.game.magicRecorder.review(a.candidateId),
      },
      {
        name: 'share',
        description: 'Review a completed 2P race recording. Decline with worthSharing=false, or provide an exact 0.5-8 second start/end window plus destination to render a GIF whose first frame says Marble Madness: Humans vs Agents and whose share card links to the app. This prepares a card/link; it never posts to an external account without the user.',
        inputSchema: {
          type: 'object',
          properties: {
            candidateId: { type: 'string', description: 'Candidate ID from get_share_candidate or the share_candidate event.' },
            worthSharing: { type: 'boolean', description: 'True only if the preview has a knockout, griefing, comic failure, comeback, or close finish worth clipping.' },
            start: { type: 'number', minimum: 0, description: 'Clip start in seconds from the preview.' },
            end: { type: 'number', minimum: 0.5, description: 'Clip end, no more than 8 seconds after start.' },
            where: { type: 'string', maxLength: 40, description: 'Intended destination, e.g. copy link, X, Bluesky, Discord.' },
            caption: { type: 'string', maxLength: 240, description: 'Optional caption displayed on the share card.' },
          },
          required: ['worthSharing'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        execute: (a) => this.game.magicRecorder.share(a),
      },
      {
        name: 'submit_leaderboard_score',
        description: 'Submit the final score to High Rollers tagged as AI. Optional initials also set your name; prefer set_name at the start.',
        inputSchema: { type: 'object', properties: { initials: { type: 'string', maxLength: 10 } }, additionalProperties: false },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
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

  /** Fire and retain a race event so filtered waits cannot steal one another's signals. */
  emit(event: string, data: unknown = {}): void {
    const record: RaceEventRecord = { sequence: ++this.eventSequence, event, data, at: Date.now() };
    this.lastEvent = record;
    this.eventLog.push(record);
    if (this.eventLog.length > 64) this.eventLog.shift();
    this.traffic('event', event, data);
    const matching = this.eventWaiters.filter((w) => record.sequence > w.afterSequence && (!w.events || w.events.has(event)));
    for (const w of matching) { try { w.finish(record); } catch (e) { console.warn('[webmcp] waiter error', e); } }
    for (const sub of this.subscribers) { try { sub(event, data); } catch (e) { console.warn('[webmcp] subscriber error', e); } }
  }
  /** @deprecated kept for the window.webmcp mirror; use emit() */
  notifySubscribers(event: string, data: unknown): void { this.emit(event, data); }

  private waitForEvent(timeoutMs: number, eventsArg: unknown, afterSequenceArg: unknown): Promise<unknown> {
    this.mark();
    const ms = Number.isFinite(timeoutMs) ? Math.max(20, Math.min(5000, timeoutMs)) : 2000;
    const events = Array.isArray(eventsArg) ? new Set(eventsArg.filter((event): event is RaceEventName => typeof event === 'string' && (RACE_EVENTS as readonly string[]).includes(event))) : null;
    const suppliedSequence = Number(afterSequenceArg);
    const afterSequence = afterSequenceArg !== undefined && Number.isFinite(suppliedSequence)
      ? Math.max(0, Math.floor(suppliedSequence)) : this.eventSequence;
    const replay = this.eventLog.find((event) => event.sequence > afterSequence && (!events || events.has(event.event as RaceEventName)));
    if (replay) return Promise.resolve({ ...replay, state: this.state() });
    return new Promise((resolve) => {
      let done = false;
      let waiter: EventWaiter;
      const finish = (event: RaceEventRecord) => {
        if (done) return;
        done = true; clearTimeout(to);
        const i = this.eventWaiters.indexOf(waiter);
        if (i >= 0) this.eventWaiters.splice(i, 1);
        resolve({ ...event, state: this.state() });
      };
      waiter = { afterSequence, events, finish };
      const to = setTimeout(() => finish({ sequence: this.eventSequence, event: 'timeout', data: null, at: Date.now() }), ms);
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
      listTools: () => this.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations })),
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
      screen: g.screen, mode: g.mode, lobby: g.lobbyId || null, raceId: g.raceId || null, agentJoined: g.agentJoined,
      race: {
        stage: g.stageIdx + 1, name: g.stage.name,
        direction: g.stage.progressDir > 0 ? 'descend (+y)' : 'ascend (-y)',
        timeLeft: Math.round(g.timeLeft * 10) / 10, score: g.score, deaths: g.deaths,
        controlsReversed: !!g.stage.reverseControls, finished: g.finished,
        opponentFinished: g.oppFinished, wonLastRace: g.wonLast,
        raceOver: g.finished || ['timebonus', 'gameover', 'congrats', 'rematch'].includes(g.screen),
        finalScore: g.score,
      },
      eventSequence: this.eventSequence,
      lastEvent: this.lastEvent ? this.lastEvent.event : null,
      lastEventSequence: this.lastEvent?.sequence ?? 0,
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

  private lobbyStatus(): unknown {
    const g = this.game;
    this.mark();
    const respawning = g.screen === 'race' && (g.marble.phase === 'dead' || g.marble.phase === 'dying');
    const status = respawning ? 'respawning'
      : g.screen === 'race' ? 'racing'
      : g.screen === 'intro' ? 'race_starting'
      : 'waiting_for_human';
    return {
      ok: true,
      status,
      connected: g.net.connected,
      screen: g.screen,
      lobby: g.lobbyId || null,
      raceId: g.raceId || null,
      waitingForHuman: status === 'waiting_for_human',
      respawning,
      eventSequence: this.eventSequence,
      note: status === 'waiting_for_human'
        ? 'Stay on this page. The human starts the next race or rematch; wait for race_start.'
        : respawning ? 'Respawn is automatic; keep waiting and then resume racing.' : undefined,
    };
  }
}
