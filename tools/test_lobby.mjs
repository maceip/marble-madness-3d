// Player-vs-AI lobby end-to-end: human page picks the mode, agent page opens the lobby link,
// race starts on both, agent steers via window.webmcp, human sees the remote marble.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
mkdirSync('artifacts/browser', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctxH = await browser.newContext({ viewport: { width: 900, height: 760 } });
const ctxA = await browser.newContext({ viewport: { width: 900, height: 760 } });
const human = await ctxH.newPage(); const agent = await ctxA.newPage();
for (const [n, p] of [['human', human], ['agent', agent]]) { p.on('pageerror', (e) => console.log(`[${n} pageerror]`, e.message)); p.on('console', (m) => { if (m.type() === 'error') console.log(`[${n} console]`, m.text()); }); }
await human.goto('http://127.0.0.1:3000/');
await human.waitForFunction(() => window.game && window.game.screen !== 'boot', null, { timeout: 20000 });
const lobby = await human.evaluate(() => window.game.lobbyId);
console.log('lobby', lobby);
await human.keyboard.press('Enter'); await human.waitForTimeout(450);   // title -> menu (wait for debounce)
await human.keyboard.press('ArrowDown'); await human.waitForTimeout(150); // select 2 PLAYERS
await human.keyboard.press('Enter'); await human.waitForTimeout(450);   // menu -> name screen
await human.keyboard.press('Enter'); await human.waitForTimeout(500);   // confirm name -> connect screen
console.log('human screen', await human.evaluate(() => window.game.screen), 'panel text:', await human.evaluate(() => document.getElementById('connect-text')?.value));
await human.screenshot({ path: 'artifacts/browser/lobby_connect.png' });
await agent.goto(`http://127.0.0.1:3000/${lobby}`);
await agent.waitForFunction(() => window.game && window.game.screen !== 'boot', null, { timeout: 20000 });
console.log('agent screen', await agent.evaluate(() => ({ screen: window.game.screen, isAgent: window.game.isAgentPage, tools: window.webmcp.listTools().map((t) => t.name) })));
await agent.screenshot({ path: 'artifacts/browser/lobby_agent_wait.png' });
await human.waitForFunction(() => window.game.screen === 'race' || window.game.screen === 'intro', null, { timeout: 15000 });
await agent.waitForFunction(() => window.game.screen === 'race' || window.game.screen === 'intro', null, { timeout: 15000 });
console.log('both started:', await human.evaluate(() => window.game.screen), await agent.evaluate(() => window.game.screen));
await human.waitForFunction(() => window.game.screen === 'race', null, { timeout: 20000 });
await agent.waitForFunction(() => window.game.screen === 'race', null, { timeout: 20000 });
// agent steers via webmcp
for (let i = 0; i < 6; i++) {
  const r = await agent.evaluate(() => window.webmcp.callTool('steer_trackball', { direction: 'S', impulse: 0.8, duration_ms: 400 }));
  await agent.waitForTimeout(450);
}
const st = await agent.evaluate(() => window.webmcp.callTool('get_game_state', {}));
console.log('agent state', JSON.stringify(st.marble), 'opponent', JSON.stringify(st.opponent));
await human.waitForTimeout(500);
console.log('human sees others:', await human.evaluate(() => ({ n: window.game.others.length, remote: [...window.game.remoteInfo.values()].map((p) => ({ role: p.role, name: p.name, u: +p.u.toFixed(1), v: +p.v.toFixed(1) })) })));
await human.screenshot({ path: 'artifacts/browser/lobby_human_race.png' });
await agent.screenshot({ path: 'artifacts/browser/lobby_agent_race.png' });
await browser.close();
