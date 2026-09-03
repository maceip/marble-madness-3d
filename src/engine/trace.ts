/**
 * Live trace channel for debugging the real prod session. Client buffers short lines and flushes them to the
 * server (sendBeacon), which prints them to its journal so a developer can `journalctl -u marbles -f` and watch
 * the player interact. On by default with ?trace=1 or localStorage.mm_trace='1'; capped so it never floods.
 *
 * mmTrace('tag', {..})  — record one line
 * mmTraceInit()         — start flushing (called once from main)
 */
const SID = Math.random().toString(36).slice(2, 8);
let enabled = false;
let buf: string[] = [];
let lastFlush = 0;
const MAX_BUF = 60;

export function mmTraceOn(): boolean { return enabled; }

export function mmTrace(tag: string, data?: Record<string, unknown>): void {
  if (!enabled) return;
  let d = '';
  if (data) { try { d = ' ' + JSON.stringify(data); } catch { d = ''; } }
  buf.push(`${(performance.now() / 1000).toFixed(2)} ${tag}${d}`);
  if (buf.length > MAX_BUF) buf = buf.slice(-MAX_BUF);
  const now = performance.now();
  if (now - lastFlush > 700) flush();
}

/** throttled per-tag heartbeat: only records `tag` at most every `everyMs` */
const beats = new Map<string, number>();
export function mmBeat(tag: string, everyMs: number, data?: Record<string, unknown>): void {
  if (!enabled) return;
  const now = performance.now();
  if (now - (beats.get(tag) ?? 0) < everyMs) return;
  beats.set(tag, now);
  mmTrace(tag, data);
}

function flush(): void {
  if (!enabled || buf.length === 0) return;
  lastFlush = performance.now();
  const lines = buf; buf = [];
  const body = JSON.stringify({ sid: SID, lines });
  try {
    if (navigator.sendBeacon && navigator.sendBeacon('/api/trace', new Blob([body], { type: 'application/json' }))) return;
  } catch { /* fall through */ }
  fetch('/api/trace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
}

export function mmTraceInit(): void {
  try {
    const q = new URLSearchParams(location.search);
    enabled = q.get('trace') === '1' || localStorage.getItem('mm_trace') === '1';
    if (q.get('trace') === '1') localStorage.setItem('mm_trace', '1');
    if (q.get('trace') === '0') { localStorage.removeItem('mm_trace'); enabled = false; }
  } catch { enabled = false; }
  if (!enabled) return;
  mmTrace('boot', { sid: SID, ua: navigator.userAgent.slice(0, 80), vibrate: 'vibrate' in navigator, dpr: window.devicePixelRatio, w: innerWidth, h: innerHeight, bridge: !!(window as unknown as { NativeBridge?: unknown }).NativeBridge });
  setInterval(flush, 1000);
  window.addEventListener('pagehide', flush);
}

export const TRACE_SID = SID;
