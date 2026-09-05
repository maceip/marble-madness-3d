import type { BitmapFont, FontVariant } from '../engine/font';
import type { Game } from '../game/game';
import { pxCanvas, pxFill, pxFillTint, pxTint, UI } from './pixel';

type TrafficPhase = 'call' | 'result' | 'error' | 'event' | 'resource';
interface TrafficDetail { phase: TrafficPhase; name: string; payload?: unknown }

const MAX_LINES = 96;

function agentSurface(game: Game): boolean {
  return game.isAgentPage;
}
const WIDE_PX = 1100;   // desktop_agent_browser.png composition (side panels) from this width; agent_webpage.png below it

function scalar(value: unknown): string {
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === 'boolean') return value ? 'YES' : 'NO';
  if (typeof value === 'string') return value.toUpperCase().slice(0, 18);
  return '';
}

function summarize(name: string, payload: unknown): string {
  const p = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  if (name === 'spin_trackball') {
    const tb = p.trackball as Record<string, unknown> | undefined;
    const vec = tb?.spinVector as Record<string, unknown> | undefined;
    return tb ? `RPM ${scalar(tb.rpm)}  VECTOR ${scalar(vec?.dx)},${scalar(vec?.dy)}`
      : `DX ${scalar(p.dx)}  DY ${scalar(p.dy)}  SPEED ${scalar(p.speed)}`;
  }
  if (name === 'get_game_state' || name === 'wait_for_tick') {
    const race = p.race as Record<string, unknown> | undefined;
    const marble = p.marble as Record<string, unknown> | undefined;
    return `STAGE ${scalar(race?.stage)}  T ${scalar(race?.timeLeft)}  XY ${scalar(marble?.x)},${scalar(marble?.y)}`;
  }
  if (name === 'wait_for_race_event') return p.event ? `${scalar(p.event)}  SCREEN ${scalar((p.state as Record<string, unknown> | undefined)?.screen)}` : `TIMEOUT ${scalar(p.timeout_ms)}MS`;
  if (name === 'set_name') return `NAME ${scalar(p.name)}  ${scalar(p.delivery)}`;
  if (name === 'get_lobby_status') return `SCREEN ${scalar(p.screen)}  WAIT ${scalar(p.waitingForHuman)}`;
  if (name === 'submit_leaderboard_score') return `NAME ${scalar(p.name)}  SCORE ${scalar(p.score)}`;
  const entries = Object.entries(p).slice(0, 3).map(([k, v]) => `${k.toUpperCase()} ${scalar(v)}`).filter((x) => !x.endsWith(' '));
  return entries.join('  ') || scalar(payload) || 'OK';
}

function wrap(text: string, width = 36): string[] {
  const words = text.trim().split(/\s+/); const lines: string[] = []; let line = '';
  for (const word of words) {
    if (word.length > width) {
      if (line) { lines.push(line); line = ''; }
      for (let i = 0; i < word.length; i += width) lines.push(word.slice(i, i + width));
    } else if (!line) line = word;
    else if (line.length + word.length + 1 <= width) line += ' ' + word;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The trackball housing and its four energy tubes (agent_webpage.png). Geometry follows the trackball's on-screen
 *  rect so the ball always sits in the bezel; the tubes leave the housing shoulders and run off the left/right edges
 *  (upper pair rising, lower pair falling) with two couplings each. Called on every tick (cheap: 4 paths, 8 rects). */
const BOLT_POOL = 3;          // concurrent sparks per tube before the oldest is recycled (agents spin many times a second)
const BOLT_LEN = 0.22;        // spark length as a fraction of the tube, white-hot head = the leading 0.09
const BOLT_MS = 380;

function buildDock(svg: SVGSVGElement): { layout(ball: HTMLElement | null): void; spark(onArrive: () => void): void } {
  const el = <T extends SVGElement>(name: string, cls: string): T => {
    const n = document.createElementNS(SVG_NS, name) as T; n.setAttribute('class', cls); svg.appendChild(n); return n;
  };
  const tubes = [-1, 1].flatMap((side) => [true, false].map((up) => ({
    side: side as -1 | 1, up, len: 0, next: 0,
    shell: el<SVGPathElement>('path', 'agent-tube-shell'),
    bore: el<SVGPathElement>('path', 'agent-tube-bore'),
    core: el<SVGPathElement>('path', 'agent-tube-core'),
    spark: el<SVGPathElement>('path', 'agent-tube-spark'),
    couplings: [el<SVGRectElement>('rect', 'agent-coupling'), el<SVGRectElement>('rect', 'agent-coupling')],
    bolts: [] as { glow: SVGPathElement; head: SVGPathElement; anims: Animation[] }[],
  })));
  // per-call sparks ride above the couplings: a wide electric-blue glow with a thin white-hot head at its leading edge
  for (const t of tubes) {
    for (let i = 0; i < BOLT_POOL; i++) t.bolts.push({ glow: el<SVGPathElement>('path', 'agent-tube-bolt'), head: el<SVGPathElement>('path', 'agent-tube-bolt-head'), anims: [] });
  }
  const plinth = el<SVGPolygonElement>('polygon', 'agent-plinth');
  const front = el<SVGRectElement>('rect', 'agent-front');
  const base = el<SVGPolygonElement>('polygon', 'agent-base');
  const bezel = el<SVGEllipseElement>('ellipse', 'agent-bezel');
  const leds = [0, 1, 2].map(() => el<SVGRectElement>('rect', 'agent-housing-led'));
  const octagon = (cx: number, cy: number, w: number, h: number): string => {
    const k = 0.3;   // corner cut
    return [[-w / 2 + w * k, -h / 2], [w / 2 - w * k, -h / 2], [w / 2, -h / 2 + h * k], [w / 2, h / 2 - h * k], [w / 2 - w * k, h / 2],
      [-w / 2 + w * k, h / 2], [-w / 2, h / 2 - h * k], [-w / 2, -h / 2 + h * k]].map(([x, y]) => `${Math.round(cx + x)},${Math.round(cy + y)}`).join(' ');
  };
  let last = '';
  return {
    layout(ball) {
      const r = svg.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const b = ball?.getBoundingClientRect();
      const W = r.width, H = r.height;
      const cx = b ? b.left + b.width / 2 - r.left : W / 2;
      const cy = b ? b.top + b.height / 2 - r.top : H * 0.7;
      const R = b ? b.width / 2 : Math.min(W, H) * 0.2;
      const sig = `${W}|${H}|${cx}|${cy}|${R}`;
      if (sig === last) return;
      last = sig;
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.setAttribute('width', String(W)); svg.setAttribute('height', String(H));
      const gauge = Math.max(0.55, Math.min(1, R / 120));   // tube thickness follows the ball size
      for (const t of tubes) {
        const px = cx + t.side * R * 1.35, py = cy + (t.up ? R * 0.15 : R * 0.9);
        const ex = t.side < 0 ? -40 : W + 40, ey = t.up ? cy - R * 0.9 : Math.min(H + R * 0.2, cy + R * 1.7);
        const mx = px + (ex - px) * 0.5;
        const d = `M ${px} ${py} C ${mx} ${py}, ${mx} ${ey}, ${ex} ${ey}`;
        for (const path of [t.shell, t.bore, t.core, t.spark]) path.setAttribute('d', d);
        t.shell.style.strokeWidth = `${44 * gauge}`; t.bore.style.strokeWidth = `${34 * gauge}`; t.core.style.strokeWidth = `${12 * gauge}`; t.spark.style.strokeWidth = `${3 * gauge}`;
        const len = t.shell.getTotalLength();
        t.len = len;
        for (const bolt of t.bolts) {
          for (const path of [bolt.glow, bolt.head]) path.setAttribute('d', d);
          // one dash per path: dash + gap >= tube length, so exactly one spark is ever visible per bolt
          bolt.glow.style.strokeDasharray = `${len * BOLT_LEN} ${len}`; bolt.glow.style.strokeWidth = `${16 * gauge}`;
          bolt.head.style.strokeDasharray = `${len * 0.09} ${len}`; bolt.head.style.strokeWidth = `${5 * gauge}`;
        }
        t.couplings.forEach((c, i) => {
          const at = len * (i === 0 ? 0.3 : 0.72);
          const p = t.shell.getPointAtLength(at), q = t.shell.getPointAtLength(Math.min(len, at + 2));
          const ang = Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI;
          const w = 22 * gauge, h = 56 * gauge;
          c.setAttribute('x', String(p.x - w / 2)); c.setAttribute('y', String(p.y - h / 2));
          c.setAttribute('width', String(w)); c.setAttribute('height', String(h)); c.setAttribute('rx', String(3 * gauge));
          c.setAttribute('transform', `rotate(${ang.toFixed(1)} ${p.x} ${p.y})`);
        });
      }
      // housing: slim plinth slab, dark front face, octagonal top deck, ring bezel the ball sits in
      plinth.setAttribute('points', octagon(cx, cy + R * 1.68, R * 3.6, R * 0.55));
      front.setAttribute('x', String(cx - R * 1.25)); front.setAttribute('y', String(cy + R * 1.15));
      front.setAttribute('width', String(R * 2.5)); front.setAttribute('height', String(R * 0.42));
      base.setAttribute('points', octagon(cx, cy + R * 0.72, R * 2.9, R * 1.1));
      bezel.setAttribute('cx', String(cx)); bezel.setAttribute('cy', String(cy + R * 0.28));
      bezel.setAttribute('rx', String(R * 1.15)); bezel.setAttribute('ry', String(R * 0.42));
      leds.forEach((led, i) => {
        const size = Math.max(4, R * 0.09);
        led.setAttribute('x', String(cx - size * 2.2 + i * size * 1.8)); led.setAttribute('y', String(cy + R * 1.31));
        led.setAttribute('width', String(size)); led.setAttribute('height', String(size));
      });
    },
    /** A trackball command arrived from the agent: fire one bright spark down every tube, page edge -> housing.
     *  The dash starts fully off the far end (offset -len) and leaves through the housing end (offset +dash). */
    spark(onArrive) {
      if (typeof Element.prototype.animate !== 'function') { onArrive(); return; }
      let arrived = false;
      for (const t of tubes) {
        if (!t.len) continue;
        const bolt = t.bolts[t.next]; t.next = (t.next + 1) % BOLT_POOL;
        for (const a of bolt.anims) a.cancel();
        bolt.anims = [];
        const from = -t.len, to = t.len * BOLT_LEN;
        const duration = BOLT_MS + (t.up ? 0 : 40) + (t.side < 0 ? 0 : 25);   // the four bolts land a beat apart
        for (const path of [bolt.glow, bolt.head]) {
          path.style.visibility = 'visible';
          const anim = path.animate([{ strokeDashoffset: from, opacity: 0.55 }, { strokeDashoffset: from * 0.4 + to * 0.6, opacity: 1, offset: 0.6 }, { strokeDashoffset: to, opacity: 1 }],
            { duration, easing: 'cubic-bezier(.45, 0, .9, .6)', fill: 'forwards' });
          anim.onfinish = () => { path.style.visibility = 'hidden'; anim.cancel(); if (!arrived) { arrived = true; onArrive(); } };
          bolt.anims.push(anim);
        }
      }
    },
  };
}

/** Permanent agent-only desktop visualization. It never follows game.screen; only its status and live bus log change. */
export function agentConsole(game: Game, font: BitmapFont): { active: boolean; tick(): void } {
  const host = document.getElementById('agent-console');
  const log = document.getElementById('agent-terminal-log');
  const active = !!host && !!log && agentSurface(game);
  if (!active || !host || !log) return { active: false, tick() {} };

  document.body.classList.add('agent-console-active');
  host.hidden = false;
  // conformance wireframe (agent_webpage.png): title rule, MCP TERMINAL panel, OPTICAL TRACKBALL under it
  const title = document.getElementById('agent-console-title');
  const TITLE = 'MARBLE MADNESS // AGENT MODE';
  let fitted = '';
  const fitChrome = () => {
    const wide = window.innerWidth >= 900;
    const key = `${window.innerWidth}`;
    if (key === fitted) return;
    fitted = key;
    const titleScale = wide ? 3 : 2;
    if (title) {
      if (TITLE.length * 8 * titleScale <= window.innerWidth - 40) pxFillTint(title, font, TITLE, UI.blue, titleScale);
      else title.replaceChildren(pxTint(font, 'MARBLE MADNESS', UI.blue, 2), pxTint(font, '// AGENT MODE', UI.blue, 2));   // phones: two lines
    }
    pxFillTint(document.getElementById('agent-terminal-title'), font, 'MCP TERMINAL', UI.blue, wide ? 2 : 1);
    pxFillTint(document.getElementById('agent-ball-caption'), font, 'OPTICAL TRACKBALL', UI.blue, wide ? 2 : 1);
    host.classList.toggle('wide', window.innerWidth >= WIDE_PX);
  };
  fitChrome();
  window.addEventListener('resize', fitChrome);
  const dockSvg = document.getElementById('agent-dock') as SVGSVGElement | null;
  const dock = dockSvg ? buildDock(dockSvg) : null;
  const ball = document.getElementById('trackball');
  pxFill(document.getElementById('agent-console-link'), font, 'MODEL CONTEXT ONLINE', 'orange', 2);
  pxFill(document.getElementById('agent-console-tools'), font, `${game.webmcp.tools.length} TOOLS // ${game.webmcp.resources.length} RESOURCES`, 'lavender', 2);

  // --- side panels (desktop composition): static chrome once, values re-painted only when they change -------------
  const DIM = '#6f9bd6', VAL = '#39e9ff';
  pxFillTint(document.getElementById('agent-status-title'), font, 'SYSTEM STATUS', '#9fc6ff', 1);
  pxFillTint(document.getElementById('agent-net-title'), font, 'NETWORK', '#9fc6ff', 1);
  pxFillTint(document.getElementById('agent-core-title'), font, 'AGENT CORE', '#9fc6ff', 1);
  pxFillTint(document.getElementById('agent-conn-title'), font, 'CONNECTIONS', '#9fc6ff', 1);
  const caption = (id: string, lines: string[]) => {
    const el = document.getElementById(id);
    if (el) el.replaceChildren(...lines.map((l) => pxTint(font, l, '#5d84bd', 1)));
  };
  caption('agent-cap-tl', ['MCP NETWORK', 'AGENTS ONLINE', 'TOOLS READY']);
  caption('agent-cap-tr', ['INTELLIGENCE', 'THROUGH', 'CONNECTIONS']);
  caption('agent-cap-ml', ['A MORE', 'CAPABLE', 'TOMORROW']);
  caption('agent-cap-mr', ['SMALL TOOLS', 'BIG POSSIBILITIES']);
  caption('agent-cap-bl', ['EST. 2024', 'MARBLE MADNESS']);
  caption('agent-cap-br', ['BUILD', 'BETTER', 'AGENTS']);
  const check = (on: boolean): HTMLCanvasElement => {      // the atlas has no check mark: draw one
    const c = document.createElement('canvas'); c.width = 8; c.height = 8;
    const x = c.getContext('2d')!; x.fillStyle = on ? VAL : '#2a4a7a';
    const rows = on ? ['.......#', '......##', '.....##.', '#...##..', '##.##...', '.###....', '..#.....', '........'] : ['........', '..####..', '.#....#.', '.#....#.', '.#....#.', '.#....#.', '..####..', '........'];
    rows.forEach((r, y) => [...r].forEach((ch, i) => { if (ch === '#') x.fillRect(i, y, 1, 1); }));
    c.style.imageRendering = 'pixelated'; c.style.width = '8px'; c.style.height = '8px';
    return c;
  };
  type Row = { label: string; value?: () => string; dot?: boolean; tick?: () => boolean };
  const panel = (rowsId: string, rows: Row[]) => {
    const host = document.getElementById(rowsId);
    if (!host) return () => {};
    const els = rows.map((r) => {
      const row = document.createElement('div'); row.className = 'agent-row';
      let dot: HTMLSpanElement | null = null;
      if (r.dot) { dot = document.createElement('span'); dot.className = 'agent-dot'; row.appendChild(dot); }
      row.appendChild(pxTint(font, r.label, DIM, 1));
      const val = document.createElement('span'); val.className = 'agent-val'; row.appendChild(val);
      host.appendChild(row);
      return { r, val, dot, last: '' };
    });
    return () => {
      for (const e of els) {
        const v = e.r.tick ? (e.r.tick() ? 'Y' : 'N') : (e.r.value?.() ?? '');
        if (v === e.last) continue;
        e.last = v;
        if (e.r.tick) e.val.replaceChildren(check(v === 'Y')); else e.val.replaceChildren(pxTint(font, v, VAL, 1));
        e.dot?.classList.toggle('on', e.r.tick ? v === 'Y' : v !== 'OFFLINE' && v !== '0' && v !== 'IDLE');
      }
    };
  };
  // telemetry sources: MCP bus events (bytes + packets), a same-origin HEAD every 5 s for latency, rAF load for CPU
  let packets = 0, bytes = 0, sawTraffic = false, busy = 0;
  const perSecond: number[] = new Array(8).fill(0);
  let secBytes = 0, lastBucket = Math.floor(performance.now() / 1000);
  window.addEventListener('mm:mcp-traffic', ((event: CustomEvent<TrafficDetail>) => {
    const d = event.detail; packets++; sawTraffic = true;
    const size = 24 + d.name.length + (d.payload === undefined ? 0 : JSON.stringify(d.payload).length);
    bytes += size; secBytes += size;
    if (d.phase === 'call') busy = performance.now();
  }) as EventListener);
  let latency = -1, pingAt = -Infinity;   // first probe on the first sync
  const ping = async () => {
    const t0 = performance.now();
    try { await fetch('/manifest.webmanifest', { cache: 'no-store' }); latency = Math.round(performance.now() - t0); } catch { latency = -1; }
  };
  let frames = 0, slow = 0, lastFrame = performance.now(), cpu = 0;
  const raf = () => {
    const now = performance.now(); frames++; if (now - lastFrame > 20) slow++; lastFrame = now;
    if (frames >= 60) { cpu = Math.round(100 * slow / frames); frames = 0; slow = 0; }
    if (document.body.classList.contains('agent-console-active')) requestAnimationFrame(raf);
  };
  requestAnimationFrame(raf);
  const bars = (id: string, values: number[]) => {
    const host = document.getElementById(id); if (!host) return;
    if (host.childElementCount !== values.length) host.replaceChildren(...values.map(() => { const b = document.createElement('span'); b.className = 'agent-bar'; return b; }));
    const max = Math.max(1, ...values);
    values.forEach((v, i) => { (host.children[i] as HTMLElement).style.height = `${Math.max(2, Math.round(18 * v / max))}px`; });
  };
  const mem = () => { const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory; return m ? `${Math.round(m.usedJSHeapSize / 1048576)} MB` : '--'; };
  const lobbyTag = game.lobbyId.slice(0, 8).toUpperCase();
  const syncStatus = panel('agent-status-rows', [
    { label: 'MCP TRANSPORT', dot: true, value: () => game.webmcp.tools.length ? 'ONLINE' : 'OFFLINE' },
    { label: 'AGENT RUNTIME', dot: true, value: () => performance.now() - busy < 400 ? 'BUSY' : 'READY' },
    { label: 'TOOL REGISTRY', dot: true, value: () => String(game.webmcp.tools.length) },
    { label: 'SESSION STATE', dot: true, value: () => /^(connect|intro|title|boot|menu)$/.test(game.screen) ? 'IDLE' : game.screen === 'race' ? 'RACING' : game.screen.toUpperCase().slice(0, 8) },
  ]);
  const syncNet = panel('agent-net-rows', [
    { label: 'LATENCY', value: () => latency < 0 ? '--' : `${latency} MS` },
    { label: 'THROUGHPUT', value: () => { const b = perSecond.reduce((a, v) => a + v, 0) / perSecond.length; return b >= 1024 ? `${(b / 1024).toFixed(1)} KB/S` : `${Math.round(b)} B/S`; } },
    { label: 'PACKETS', value: () => packets.toLocaleString('en-US') },
  ]);
  const syncCore = panel('agent-core-rows', [
    { label: 'CPU', value: () => `${cpu}%` },
    { label: 'MEM', value: mem },
    { label: 'CONTEXT', value: () => ('modelContext' in navigator || game.webmcp.tools.length) ? 'ACTIVE' : 'NONE' },
    { label: 'AGENTS', value: () => String(game.net.connected ? 1 : 0) },
    { label: 'TOOLS', value: () => String(game.webmcp.tools.length) },
  ]);
  const syncConn = panel('agent-conn-rows', [
    { label: 'WEBMCP', dot: true, tick: () => game.webmcp.tools.length > 0 },
    { label: `LOBBY ${lobbyTag}`, dot: true, tick: () => game.net.connected },
    { label: 'TOOLCHAIN', dot: true, tick: () => game.webmcp.tools.length > 0 },
    { label: 'AGENT BUS', dot: true, tick: () => sawTraffic },
    { label: 'EVENT STREAM', dot: true, tick: () => game.webmcp.resources.length > 0 },
  ]);
  const cpuHist: number[] = new Array(8).fill(0);
  const syncPanels = () => {
    const bucket = Math.floor(performance.now() / 1000);
    if (bucket !== lastBucket) { for (let b = lastBucket; b < bucket && b < lastBucket + 8; b++) { perSecond.shift(); perSecond.push(b === bucket - 1 ? secBytes : 0); } secBytes = 0; lastBucket = bucket; cpuHist.shift(); cpuHist.push(cpu); }
    if (performance.now() - pingAt > 5000) { pingAt = performance.now(); void ping(); }
    syncStatus(); syncNet(); syncCore(); syncConn();
    bars('agent-net-bars', perSecond); bars('agent-core-bars', cpuHist.map((c) => c + 4));
  };

  const logMetrics = () => {
    const w = log.clientWidth || window.innerWidth - 60;
    const scale = w >= 960 ? 3 : 2;
    return { scale, cols: Math.max(24, Math.floor((w - 36) / (8 * scale))) };
  };
  const add = (text: string, variant: FontVariant = 'white') => {
    const { scale, cols } = logMetrics();
    for (const part of wrap(text, cols)) {
      const row = document.createElement('div'); row.className = 'agent-log-line';
      row.setAttribute('aria-label', part);
      row.appendChild(pxCanvas(font, part, variant, scale)); log.appendChild(row);
    }
    while (log.children.length > MAX_LINES) log.firstElementChild?.remove();
    log.scrollTop = log.scrollHeight;
  };
  add('[BOOT] WEBMCP TRANSPORT ONLINE', 'cyan');
  add(`[LINK] LOBBY ${game.lobbyId.slice(0, 8).toUpperCase()}`, 'lavender');
  add(`[READY] ${game.webmcp.tools.length} TOOLS REGISTERED`, 'orange');
  add('> WAITING FOR AGENT TRAFFIC_', 'white');

  let arriveId = 0;
  const sparkArrive = () => {
    const id = ++arriveId;
    host.classList.add('spark-arrive');
    window.setTimeout(() => { if (id === arriveId) host.classList.remove('spark-arrive'); }, 180);
  };
  let pulseId = 0;
  const pulse = (toward: 'ball' | 'terminal', strong: boolean) => {
    const id = ++pulseId;
    host.classList.remove('pulse-to-ball', 'pulse-to-terminal', 'pulse-spin');
    void host.offsetWidth;
    host.classList.add(toward === 'ball' ? 'pulse-to-ball' : 'pulse-to-terminal');
    if (strong) host.classList.add('pulse-spin');
    window.setTimeout(() => { if (id === pulseId) host.classList.remove('pulse-to-ball', 'pulse-to-terminal', 'pulse-spin'); }, 560);
  };

  window.addEventListener('mm:mcp-traffic', ((event: CustomEvent<TrafficDetail>) => {
    const d = event.detail; const strong = d.name === 'spin_trackball';
    if (d.phase === 'call') {
      add(`> ${d.name.toUpperCase()}  ${summarize(d.name, d.payload)}`, strong ? 'orange' : 'white');
      pulse('ball', strong);
      if (strong) dock?.spark(sparkArrive);   // every trackball command: electric-blue spark down all four tubes
    }
    else if (d.phase === 'result') { add(`< ${d.name.toUpperCase()}  ${summarize(d.name, d.payload)}`, 'cyan'); pulse('terminal', strong); }
    else if (d.phase === 'event') { add(`! EVENT ${d.name.toUpperCase()}  ${summarize(d.name, d.payload)}`, 'orange'); pulse('terminal', false); }
    else if (d.phase === 'resource') { add(`@ READ ${d.name.toUpperCase()}`, 'lavender'); pulse('terminal', false); }
    else { add(`! ERROR ${d.name.toUpperCase()}  ${summarize(d.name, d.payload)}`, 'orange'); pulse('terminal', true); }
  }) as EventListener);

  let lastStatus = ''; let lastPaint = 0;
  return {
    active: true,
    tick() {
      const now = performance.now(); if (now - lastPaint < 150) return; lastPaint = now;
      dock?.layout(ball);
      if (host.classList.contains('wide')) syncPanels();
      const rpm = Math.round(Math.hypot(game.input.trackball.wx, game.input.trackball.wy) * 9.55);
      const status = `LINK ${game.net.connected ? 'UP' : 'SYNC'} // ${game.screen.toUpperCase()} // ${rpm} RPM`;
      if (status !== lastStatus) { lastStatus = status; pxFill(document.getElementById('agent-console-status'), font, status, game.net.connected ? 'cyan' : 'orange', 2); }
    },
  };
}
