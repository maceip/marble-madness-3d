// Probes the production WebMCP surface through the browser registration API Codex Site Tools uses.
import { chromium } from 'playwright-core';
const BASE = process.env.BASE || 'http://127.0.0.1:3200';
const b = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (await b.newContext()).newPage();
await page.addInitScript(() => {
  const cap = { tools: [], resources: [], prompts: [], method: [] };
  window.__mcpcap = cap;
  const mc = {
    registerTool: (t) => { cap.method.push('registerTool'); cap.tools.push(t); },
    registerResource: (r) => { cap.method.push('registerResource'); cap.resources.push(r); },
    registerPrompt: (p) => { cap.method.push('registerPrompt'); cap.prompts.push(p); },
  };
  Object.defineProperty(document, 'modelContext', { value: mc, configurable: true });
});
await page.goto(`${BASE}/11111111-2222-3333-4444-555555555555`);
await page.waitForFunction(() => window.game && window.game.stage);
await page.waitForTimeout(300);
let fails = 0; const check = (n, ok, d = '') => { console.log(`  ${ok ? '✓' : '✗'} ${n}${d ? '  ' + d : ''}`); if (!ok) fails++; };
const rep = await page.evaluate(async () => {
  const cap = window.__mcpcap;
  const names = cap.tools.map((t) => t.name);
  const gs = cap.tools.find((t) => t.name === 'get_game_state');
  const out = gs ? await gs.execute({}) : null;
  const shape = out && Array.isArray(out.content) && out.content[0]?.type === 'text' && out.structuredContent ? 'mcp-content' : typeof out;
  const course = cap.tools.find((t) => t.name === 'get_course');
  const courseOut = course ? await course.execute({}) : null;
  const lobbyStatus = cap.tools.find((t) => t.name === 'get_lobby_status');
  const lobbyOut = lobbyStatus ? await lobbyStatus.execute({}) : null;
  // A filtered wait must ignore unrelated events, and cursor replay must recover an event fired between calls.
  const wtool = cap.tools.find((t) => t.name === 'wait_for_race_event');
  let waitEvent = null; let filtered = false; let replayEvent = null;
  if (wtool) {
    const cursor = out?.structuredContent?.eventSequence ?? 0;
    let settled = false;
    const p = wtool.execute({ timeout_ms: 3000, events: ['race_start'], after_sequence: cursor }).then((r) => { settled = true; return r; });
    window.game.webmcp.emit('share_candidate', { id: 'probe' });
    await new Promise((resolve) => setTimeout(resolve, 80));
    filtered = !settled;
    window.game.webmcp.emit('race_start', { stage: 1 });
    const waited = await p;
    waitEvent = waited?.structuredContent?.event ?? null;
    const after = waited?.structuredContent?.sequence ?? cursor;
    window.game.webmcp.emit('death', { kind: 'void', deaths: 1 });
    const replayed = await wtool.execute({ timeout_ms: 500, events: ['death'], after_sequence: after });
    replayEvent = replayed?.structuredContent?.event ?? null;
  }
  const spin = cap.tools.find((t) => t.name === 'spin_trackball');
  const spinOut = spin ? await spin.execute({ dx: 0, dy: 1, speed: 10 }) : null;
  const spinHint = typeof spinOut?.structuredContent?.hint === 'string' && /brake/i.test(spinOut.structuredContent.hint);
  const race = out?.structuredContent?.race;
  const strict = cap.tools.every((t) => t.inputSchema?.additionalProperties === false);
  const annotated = cap.tools.every((t) => t.annotations && typeof t.annotations === 'object');
  return {
    method: [...new Set(cap.method)], names, resultShape: shape, resources: cap.resources.map((r) => r.uri),
    waitEvent, filtered, replayEvent, hasState: !!race,
    hasFinish: !!(race && 'finished' in race && 'wonLastRace' in race && 'finalScore' in race), spinHint,
    course: courseOut?.structuredContent, lobby: lobbyOut?.structuredContent, strict, annotated,
  };
});
check('registers through document.modelContext.registerTool', rep.method.includes('registerTool'), rep.method.join(','));
check('tool result is MCP content shape', rep.resultShape === 'mcp-content', rep.resultShape);
check('has set_name tool', rep.names.includes('set_name'));
check('has wait_for_race_event tool', rep.names.includes('wait_for_race_event'));
check('has spin_trackball tool', rep.names.includes('spin_trackball'));
check('has directly discoverable get_course tool', rep.names.includes('get_course') && Array.isArray(rep.course?.route));
check('has read-only get_lobby_status tool', rep.names.includes('get_lobby_status') && typeof rep.lobby?.status === 'string');
check('dropped misleading start_or_respawn tool', !rep.names.includes('start_or_respawn'));
check('dropped steer_trackball', !rep.names.includes('steer_trackball'));
check('dropped apply_brake', !rep.names.includes('apply_brake'));
check('all tool schemas reject undeclared inputs', rep.strict);
check('all tools expose behavior annotations', rep.annotated);
check('get_game_state exposes race state', rep.hasState);
check('get_game_state exposes finished/won/finalScore', rep.hasFinish);
check('spin_trackball carries no-brakes hint', rep.spinHint);
check('filtered event wait ignores unrelated events', rep.filtered && rep.waitEvent === 'race_start', `filtered=${rep.filtered} event=${rep.waitEvent}`);
check('event cursor replays an event emitted between calls', rep.replayEvent === 'death', 'event=' + rep.replayEvent);
console.log('  tools:', rep.names.join(', '));

const page2 = await (await b.newContext()).newPage();
await page2.addInitScript(() => {
  const cap = { tools: [], method: [] };
  window.__mcpcap = cap;
  const mc = {
    provideContext: (c) => { cap.method.push('provideContext'); if (c?.tools) cap.tools.push(...c.tools); },
  };
  Object.defineProperty(navigator, 'modelContext', { value: mc, configurable: true });
});
await page2.goto(`${BASE}/11111111-2222-3333-4444-555555555555`);
await page2.waitForFunction(() => window.game && window.game.stage);
await page2.waitForTimeout(300);
const only = await page2.evaluate(() => ({ method: window.__mcpcap.method, n: window.__mcpcap.tools.length }));
check('provideContext-only host still registers', only.method.includes('provideContext') && only.n > 0, `method=${only.method.join(',')} n=${only.n}`);
await b.close();
console.log(fails ? `\nMCP PROBE: FAIL (${fails})` : '\nMCP PROBE: PASS');
process.exit(fails ? 1 : 0);
