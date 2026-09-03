// Probes the WebMCP surface for MCP-spec conformance: provideContext (+ provideContext-only hosts),
// MCP-shaped tool results, set_name / wait_for_race_event, trimmed tool set (no steer/brake).
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
    provideContext: (c) => { cap.method.push('provideContext'); if (c?.tools) cap.tools.push(...c.tools); if (c?.resources) cap.resources.push(...c.resources); },
  };
  Object.defineProperty(navigator, 'modelContext', { value: mc, configurable: true });
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
  // wait_for_race_event must resolve when an event fires
  const wtool = cap.tools.find((t) => t.name === 'wait_for_race_event');
  let waitEvent = null;
  if (wtool) { const p = wtool.execute({ timeout_ms: 3000 }); setTimeout(() => window.game.webmcp.emit('death', { kind: 'void', deaths: 1 }), 200); const r = await p; waitEvent = r?.structuredContent?.event ?? null; }
  const spin = cap.tools.find((t) => t.name === 'spin_trackball');
  const spinOut = spin ? await spin.execute({ dx: 0, dy: 1, speed: 10 }) : null;
  const spinHint = typeof spinOut?.structuredContent?.hint === 'string' && /brake/i.test(spinOut.structuredContent.hint);
  const race = out?.structuredContent?.race;
  return { method: [...new Set(cap.method)], names, resultShape: shape, resources: cap.resources.map((r) => r.uri), waitEvent, hasState: !!race, hasFinish: !!(race && 'finished' in race && 'wonLastRace' in race && 'finalScore' in race), spinHint };
});
check('registers via provideContext', rep.method.includes('provideContext'), rep.method.join(','));
check('tool result is MCP content shape', rep.resultShape === 'mcp-content', rep.resultShape);
check('has set_name tool', rep.names.includes('set_name'));
check('has wait_for_race_event tool', rep.names.includes('wait_for_race_event'));
check('has spin_trackball tool', rep.names.includes('spin_trackball'));
check('dropped steer_trackball', !rep.names.includes('steer_trackball'));
check('dropped apply_brake', !rep.names.includes('apply_brake'));
check('get_game_state exposes race state', rep.hasState);
check('get_game_state exposes finished/won/finalScore', rep.hasFinish);
check('spin_trackball carries no-brakes hint', rep.spinHint);
check('wait_for_race_event wakes on emit', rep.waitEvent === 'death', 'event=' + rep.waitEvent);
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
