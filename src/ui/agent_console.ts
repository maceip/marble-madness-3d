import type { BitmapFont, FontVariant } from '../engine/font';
import type { Game } from '../game/game';
import { pxCanvas, pxFill } from './pixel';

type TrafficPhase = 'call' | 'result' | 'error' | 'event' | 'resource';
interface TrafficDetail { phase: TrafficPhase; name: string; payload?: unknown }

const MAX_LINES = 96;

function desktopAgentSurface(game: Game): boolean {
  return game.isAgentPage && navigator.maxTouchPoints === 0;
}

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

/** Permanent agent-only desktop visualization. It never follows game.screen; only its status and live bus log change. */
export function agentConsole(game: Game, font: BitmapFont): { active: boolean; tick(): void } {
  const host = document.getElementById('agent-console');
  const log = document.getElementById('agent-terminal-log');
  const active = !!host && !!log && desktopAgentSurface(game);
  if (!active || !host || !log) return { active: false, tick() {} };

  document.body.classList.add('agent-console-active');
  host.hidden = false;
  pxFill(document.getElementById('agent-console-title'), font, 'MARBLE MADNESS // AGENT MCP', 'cyan', 2);
  pxFill(document.getElementById('agent-console-link'), font, 'MODEL CONTEXT ONLINE', 'orange', 2);
  pxFill(document.getElementById('agent-ball-caption'), font, 'OPTICAL TRACKBALL', 'white', 2);
  pxFill(document.getElementById('agent-flux-label'), font, 'FLUX LINK', 'orange', 2);
  pxFill(document.getElementById('agent-console-tools'), font, `${game.webmcp.tools.length} TOOLS // ${game.webmcp.resources.length} RESOURCES`, 'lavender', 2);

  const add = (text: string, variant: FontVariant = 'white') => {
    for (const part of wrap(text)) {
      const row = document.createElement('div'); row.className = 'agent-log-line';
      row.setAttribute('aria-label', part);
      row.appendChild(pxCanvas(font, part, variant, 2)); log.appendChild(row);
    }
    while (log.children.length > MAX_LINES) log.firstElementChild?.remove();
    log.scrollTop = log.scrollHeight;
  };
  add('[BOOT] WEBMCP TRANSPORT ONLINE', 'cyan');
  add(`[LINK] LOBBY ${game.lobbyId.slice(0, 8).toUpperCase()}`, 'lavender');
  add(`[READY] ${game.webmcp.tools.length} TOOLS REGISTERED`, 'orange');
  add('> WAITING FOR AGENT TRAFFIC_', 'white');

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
    if (d.phase === 'call') { add(`> ${d.name.toUpperCase()}  ${summarize(d.name, d.payload)}`, strong ? 'orange' : 'white'); pulse('ball', strong); }
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
      const rpm = Math.round(Math.hypot(game.input.trackball.wx, game.input.trackball.wy) * 9.55);
      const status = `LINK ${game.net.connected ? 'UP' : 'SYNC'} // ${game.screen.toUpperCase()} // ${rpm} RPM`;
      if (status !== lastStatus) { lastStatus = status; pxFill(document.getElementById('agent-console-status'), font, status, game.net.connected ? 'cyan' : 'orange', 2); }
    },
  };
}
