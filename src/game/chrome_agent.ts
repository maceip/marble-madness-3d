import type { Game } from './game';
import { mmTrace } from '../engine/trace';

type ChromeAvailability = 'unknown' | 'checking' | 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'missing';
type ChromeAgentPhase = 'idle' | 'starting' | 'downloading' | 'joining' | 'thinking' | 'playing' | 'error';

interface LanguageModelSession {
  prompt(input: string, options?: { responseConstraint?: Record<string, unknown>; omitResponseConstraintInput?: boolean; signal?: AbortSignal }): Promise<string>;
  destroy?(): void;
}

interface LanguageModelGlobal {
  availability(options?: unknown): Promise<string>;
  create(options?: unknown): Promise<LanguageModelSession>;
}

interface WebMcpBridge {
  callTool(name: string, args?: Record<string, unknown>): Promise<unknown>;
  readResource(uri: string): Promise<{ contents?: { text?: string }[] }>;
}

interface AgentAction {
  dx: number;
  dy: number;
  speed: number;
  hold_ms: number;
}

interface AgentPlan { actions: AgentAction[] }

const MODEL_OPTIONS = {
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
};

const ACTION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    actions: {
      type: 'array', minItems: 1, maxItems: 4,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          dx: { type: 'number', minimum: -1, maximum: 1 },
          dy: { type: 'number', minimum: -1, maximum: 1 },
          speed: { type: 'number', minimum: 1, maximum: 100 },
          hold_ms: { type: 'integer', minimum: 40, maximum: 350 },
        },
        required: ['dx', 'dy', 'speed', 'hold_ms'],
      },
    },
  },
  required: ['actions'],
};

const SYSTEM_PROMPT = `You are the red Player 2 marble in Marble Madness. You operate the same physical
arcade trackball exposed to other WebMCP agents. The trackball has inertia and no brake: reverse the current
motion to slow down. Screen x grows right and screen y grows down. Use the route target and current position,
velocity, support, hazards, and trackball RPM to choose a SHORT burst of one to four swipes. Avoid cliffs,
reduce speed before narrow turns, and make forward progress. Return only the requested JSON action plan.`;

function languageModel(): LanguageModelGlobal | undefined {
  return (globalThis as unknown as { LanguageModel?: LanguageModelGlobal }).LanguageModel;
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function parsePlan(raw: string): AgentPlan {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('Chrome AI returned no JSON action plan');
    value = JSON.parse(raw.slice(a, b + 1));
  }
  const actions = (value as { actions?: unknown })?.actions;
  if (!Array.isArray(actions) || actions.length === 0) throw new Error('Chrome AI returned an empty action plan');
  return {
    actions: actions.slice(0, 4).map((a) => {
      const item = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>;
      let dx = clamp(item.dx, -1, 1, 0), dy = clamp(item.dy, -1, 1, 1);
      const length = Math.hypot(dx, dy);
      if (length > 1) { dx /= length; dy /= length; }
      if (length < 0.05) dy = 0.2;
      return {
        dx: +dx.toFixed(3), dy: +dy.toFixed(3),
        speed: Math.round(clamp(item.speed, 1, 100, 50)),
        hold_ms: Math.round(clamp(item.hold_ms, 40, 350, 120)),
      };
    }),
  };
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const timer = window.setTimeout(done, ms);
    function done(): void { signal.removeEventListener('abort', abort); resolve(); }
    function abort(): void { clearTimeout(timer); reject(signal.reason); }
    signal.addEventListener('abort', abort, { once: true });
  });
}

/**
 * Extension-free desktop Chrome opponent. LangGraph owns the bounded observe -> decide -> act cycle;
 * Chrome's on-device Prompt API supplies the decision and the existing WebMCP bridge executes it.
 * The agent lives in a same-origin lobby iframe, so networking and game rules are identical to Codex.
 */
export class ChromeLocalAgent {
  availability: ChromeAvailability = 'unknown';
  phase: ChromeAgentPhase = 'idle';
  progress = 0;
  message = '';
  private frame: HTMLIFrameElement | null = null;
  private session: LanguageModelSession | null = null;
  private runAbort: AbortController | null = null;
  private probePromise: Promise<void> | null = null;

  constructor(private readonly game: Game) {}

  get optionVisible(): boolean {
    return !this.game.isAgentPage && matchMedia('(pointer: fine)').matches &&
      this.availability !== 'missing' && this.availability !== 'unavailable';
  }

  get active(): boolean { return !!this.runAbort && !this.runAbort.signal.aborted; }

  get buttonLabel(): string {
    if (this.phase === 'downloading') return `DOWNLOADING ${Math.round(this.progress * 100)}%`;
    if (this.phase === 'starting' || this.phase === 'joining') return 'STARTING CHROME AI';
    if (this.phase === 'thinking' || this.phase === 'playing') return 'CHROME AI CONNECTED';
    if (this.phase === 'error') return 'RETRY CHROME AI';
    if (this.availability === 'downloadable' || this.availability === 'downloading') return 'DOWNLOAD CHROME AI';
    return 'PLAY VS CHROME AI';
  }

  get statusText(): string {
    if (this.phase === 'downloading') return `DOWNLOADING LOCAL AI ${Math.round(this.progress * 100)}%`;
    if (this.phase === 'starting') return 'STARTING LOCAL AI';
    if (this.phase === 'joining') return 'CHROME AI JOINING';
    if (this.phase === 'thinking') return 'CHROME AI THINKING';
    if (this.phase === 'playing') return 'CHROME AI CONNECTED';
    if (this.phase === 'error') return this.message || 'CHROME AI ERROR';
    return '';
  }

  probe(): Promise<void> {
    if (this.probePromise) return this.probePromise;
    this.probePromise = this.runProbe().finally(() => { this.probePromise = null; });
    return this.probePromise;
  }

  private async runProbe(): Promise<void> {
    if (this.game.isAgentPage || !matchMedia('(pointer: fine)').matches) return;
    const api = languageModel();
    if (!api) { this.availability = 'missing'; this.changed(); return; }
    this.availability = 'checking'; this.changed();
    try {
      const value = await api.availability(MODEL_OPTIONS);
      this.availability = value === 'available' || value === 'downloadable' || value === 'downloading'
        ? value : 'unavailable';
    } catch {
      this.availability = 'unavailable';
    }
    this.changed();
  }

  async start(): Promise<void> {
    if (this.active || this.game.isAgentPage) return;
    const api = languageModel();
    if (!api) { this.fail('CHROME AI NOT AVAILABLE'); return; }
    const abort = new AbortController();
    this.runAbort = abort;
    this.phase = 'starting'; this.message = ''; this.progress = 0; this.changed();
    try {
      const availability = await api.availability(MODEL_OPTIONS);
      if (availability === 'unavailable') throw new Error('Chrome AI is unavailable on this computer');
      this.availability = availability === 'available' ? 'available' : availability as ChromeAvailability;
      if (availability === 'downloadable' || availability === 'downloading') this.phase = 'downloading';
      this.changed();
      this.session = await api.create({
        ...MODEL_OPTIONS,
        signal: abort.signal,
        initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }],
        monitor: (monitor: EventTarget) => {
          monitor.addEventListener('downloadprogress', (event) => {
            const loaded = Number((event as Event & { loaded?: number }).loaded ?? 0);
            if (Number.isFinite(loaded)) {
              this.progress = Math.max(0, Math.min(1, loaded));
              this.phase = 'downloading'; this.changed();
            }
          });
        },
      });
      if (abort.signal.aborted) return;
      this.availability = 'available'; this.phase = 'joining'; this.changed();
      const bridge = await this.joinAgentFrame(abort.signal);
      await bridge.callTool('set_name', { name: 'CHROME AI' });
      this.phase = 'thinking'; this.changed();
      await this.runGraph(bridge, this.session, abort.signal);
      if (!abort.signal.aborted) this.stop();
    } catch (error) {
      if (!abort.signal.aborted) this.fail(error instanceof Error ? error.message : String(error));
    }
  }

  stop(): void {
    const previous = this.runAbort;
    this.runAbort = null;
    previous?.abort(new DOMException('Chrome AI stopped', 'AbortError'));
    try { this.session?.destroy?.(); } catch { /* already closed */ }
    this.session = null;
    this.frame?.remove(); this.frame = null;
    if (this.phase !== 'error') this.phase = 'idle';
    this.changed();
  }

  private async joinAgentFrame(signal: AbortSignal): Promise<WebMcpBridge> {
    this.frame?.remove();
    const frame = document.createElement('iframe');
    frame.className = 'chrome-agent-frame';
    frame.title = 'Chrome AI Player 2';
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('allow', 'language-model');
    frame.src = `/${encodeURIComponent(this.game.lobbyId)}?chrome_ai=1`;
    document.body.appendChild(frame);
    this.frame = frame;
    const deadline = performance.now() + 30000;
    while (!signal.aborted && performance.now() < deadline) {
      try {
        const child = frame.contentWindow as unknown as { webmcp?: WebMcpBridge } | null;
        if (child?.webmcp) return child.webmcp;
      } catch { /* same-origin page is still navigating */ }
      await delay(50, signal);
    }
    throw new Error('Chrome AI player could not join the lobby');
  }

  private async runGraph(bridge: WebMcpBridge, session: LanguageModelSession, signal: AbortSignal): Promise<void> {
    // Keep the orchestration runtime out of the initial game bundle. It is fetched only after the
    // user explicitly chooses Chrome AI (and after LanguageModel.create preserves that activation).
    const { Annotation, END, START, StateGraph } = await import('@langchain/langgraph/web');
    const CycleState = Annotation.Root({
      snapshot: Annotation<Record<string, unknown>>(),
      course: Annotation<Record<string, unknown>>(),
      plan: Annotation<AgentPlan>(),
    });
    const graph = new StateGraph(CycleState)
      .addNode('observe', async () => {
        const snapshot = await bridge.callTool('get_game_state') as Record<string, unknown>;
        let course: Record<string, unknown> = {};
        const resource = await bridge.readResource('game://course');
        const text = resource.contents?.[0]?.text;
        if (text) course = JSON.parse(text) as Record<string, unknown>;
        return { snapshot, course, plan: { actions: [] } };
      })
      .addNode('decide', async (state: typeof CycleState.State) => {
        this.phase = 'thinking'; this.changed();
        const raw = await session.prompt(
          `CURRENT GAME STATE\n${JSON.stringify(state.snapshot)}\nCOURSE AND ROUTE\n${JSON.stringify(state.course)}\nChoose the next short action burst.`,
          { responseConstraint: ACTION_SCHEMA, omitResponseConstraintInput: false, signal },
        );
        return { plan: parsePlan(raw) };
      }, { timeout: 15000 })
      .addNode('act', async (state: typeof CycleState.State) => {
        this.phase = 'playing'; this.changed();
        for (const action of state.plan.actions) {
          if (signal.aborted) break;
          await bridge.callTool('spin_trackball', action as unknown as Record<string, unknown>);
          await delay(action.hold_ms, signal);
        }
        return {};
      })
      .addEdge(START, 'observe')
      .addConditionalEdges('observe', (state: typeof CycleState.State) => {
        const snapshot = state.snapshot as { screen?: string; marble?: { phase?: string }; race?: { raceOver?: boolean } };
        return snapshot.screen === 'race' && snapshot.marble?.phase === 'alive' && !snapshot.race?.raceOver ? 'decide' : END;
      })
      .addEdge('decide', 'act')
      .addEdge('act', END)
      .compile();

    let failures = 0;
    let enteredRace = false;
    while (!signal.aborted) {
      try {
        const result = await graph.invoke({ snapshot: {}, course: {}, plan: { actions: [] } }, { signal, recursionLimit: 8 });
        failures = 0;
        const snapshot = result.snapshot as { screen?: unknown; race?: { raceOver?: boolean } };
        const screen = String(snapshot?.screen ?? '');
        if (screen === 'race') enteredRace = true;
        // The iframe starts on connect while it waits for the human, so that state is not terminal
        // until a race has actually begun. Once it has, leaving race (or raceOver) is the end of this run.
        if (enteredRace && (screen !== 'race' || snapshot.race?.raceOver)) break;
        if (screen !== 'race') { this.phase = 'joining'; this.changed(); }
        await delay(screen === 'race' ? 60 : 250, signal);
      } catch (error) {
        if (signal.aborted) break;
        failures += 1;
        mmTrace('chromeAgent.cycleError', { failures, message: error instanceof Error ? error.message : String(error) });
        if (failures >= 3) throw error;
        await delay(250, signal);
      }
    }
  }

  private fail(message: string): void {
    this.runAbort = null;
    try { this.session?.destroy?.(); } catch { /* no-op */ }
    this.session = null;
    this.frame?.remove(); this.frame = null;
    this.phase = 'error'; this.message = message.toUpperCase().slice(0, 34);
    mmTrace('chromeAgent.error', { message });
    this.changed();
  }

  private changed(): void {
    window.dispatchEvent(new CustomEvent('mm:chrome-agent-status', { detail: {
      availability: this.availability, phase: this.phase, progress: this.progress, message: this.message,
    } }));
  }
}
