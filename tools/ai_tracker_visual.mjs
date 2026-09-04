// Real two-browser regression for the human-side AI marble callout.
// Defaults to local development; set BASE=https://marbles.secure.build for release proof.
import { chromium } from 'playwright-core';

const BASE = (process.env.BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');
const OUT = process.env.OUT || 'artifacts/ai-tracker-mobile.png';
const EDGE_OUT = OUT.replace(/\.png$/i, '-offscreen.png');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const humanContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const agentContext = await browser.newContext({ viewport: { width: 1100, height: 760 } });
const human = await humanContext.newPage();
const agent = await agentContext.newPage();
const errors = [];
for (const [who, page] of [['human', human], ['agent', agent]]) {
  page.on('pageerror', (error) => errors.push(`${who}: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`${who}: ${message.text()}`); });
}
let failures = 0;
const check = (name, pass, detail = '') => {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (!pass) failures++;
};

await human.goto(`${BASE}/`);
await human.waitForFunction(() => window.game?.screens);
const lobby = await human.evaluate(() => {
  game.mode = 'ai'; game.playerName = 'HUMAN'; game.go('connect'); return game.lobbyId;
});
await agent.goto(`${BASE}/${lobby}`);
await agent.waitForFunction(() => window.webmcp?.callTool);
await agent.evaluate(() => window.webmcp.callTool('set_name', { name: 'CODEX' }));
check('real two-player race starts', await Promise.all([
  human.waitForFunction(() => game.screen === 'race', null, { timeout: 25000 }),
  agent.waitForFunction(() => game.screen === 'race', null, { timeout: 25000 }),
]).then(() => true).catch(() => false));
const dockLayout = await human.evaluate(() => {
  const dock = document.querySelector('#trackball-container')?.getBoundingClientRect();
  const settings = document.querySelector('#settings')?.getBoundingClientRect();
  const support = document.querySelector('#support-link')?.getBoundingClientRect();
  return { dock: dock?.toJSON(), settings: settings?.toJSON(), support: support?.toJSON(), width: innerWidth };
});
check('mobile trackball dock clears the settings and privacy strip', !!dockLayout.dock && !!dockLayout.settings && dockLayout.dock.bottom <= dockLayout.settings.top, JSON.stringify(dockLayout));
check('mobile settings and support link stay inside the viewport', !!dockLayout.settings && !!dockLayout.support && dockLayout.settings.left >= 0 && dockLayout.settings.right <= dockLayout.width && dockLayout.support.right <= dockLayout.width, JSON.stringify(dockLayout));

await human.waitForFunction(() => game.aiTrackerDebug.size === 1, null, { timeout: 6000 });
const first = await human.evaluate(() => [...game.aiTrackerDebug.values()][0]);
check('AI callout uses game-space coordinates', first.targetX >= -40 && first.targetX <= 328 && first.targetY >= -80 && first.targetY <= 320, JSON.stringify(first));
check('AI callout is visibly tethered to marble', Math.hypot(first.tagX - first.targetX, first.tagY - first.targetY) <= 85, JSON.stringify(first));
check('AI callout stays inside the 288x240 playfield', first.tagX >= 31 && first.tagX <= 257 && first.tagY >= 41 && first.tagY <= 224, JSON.stringify(first));

await agent.evaluate(() => window.webmcp.callTool('spin_trackball', { dx: 0.8, dy: 0.55, speed: 70 }));
await human.waitForTimeout(900);
const moved = await human.evaluate(() => [...game.aiTrackerDebug.values()][0]);
check('callout follows live network marble movement', Math.hypot(moved.targetX - first.targetX, moved.targetY - first.targetY) > 1, `${JSON.stringify(first)} -> ${JSON.stringify(moved)}`);
await human.screenshot({ path: OUT, fullPage: true });

await agent.evaluate(() => {
  game.paused = true;
  const m = game.marble;
  game.net.sendState(10, {
    stage: game.stageIdx + 1, u: m.u, v: m.v, z: m.z + 55, vu: -8, vv: 6,
    phase: 'alive', score: game.score, time: game.timeLeft,
    progress: (m.u + m.v) * game.stage.progressDir, fin: 0, deaths: game.deaths,
  });
});
await human.waitForFunction((previousY) => [...game.aiTrackerDebug.values()][0]?.targetY < previousY - 35, moved.targetY, { timeout: 4000 });
const airborne = await human.evaluate(() => [...game.aiTrackerDebug.values()][0]);
check('callout follows airborne/drop height, not just ground position', airborne.targetY < moved.targetY - 35, `${moved.targetY.toFixed(1)} -> ${airborne.targetY.toFixed(1)}`);

await agent.evaluate(() => {
  game.net.sendState(10, {
    stage: game.stageIdx + 1, u: 120, v: -80, z: 0, vu: 20, vv: -20,
    phase: 'alive', score: game.score, time: game.timeLeft,
    progress: 40 * game.stage.progressDir, fin: 0, deaths: game.deaths,
  });
});
await human.waitForFunction(() => {
  const state = [...game.aiTrackerDebug.values()][0];
  return state?.offscreen === true && state.targetX > game.r.viewW;
}, null, { timeout: 4000 });
const edge = await human.evaluate(() => [...game.aiTrackerDebug.values()][0]);
check('offscreen AI gets a clamped edge pointer', edge.offscreen && edge.tagX >= 31 && edge.tagX <= 257 && edge.tagY >= 41 && edge.tagY <= 224, JSON.stringify(edge));

await human.screenshot({ path: EDGE_OUT, fullPage: true });
check('no browser errors', errors.length === 0, errors.slice(0, 4).join(' | '));
await browser.close();
console.log(failures ? `AI TRACKER: FAIL (${failures})` : `AI TRACKER: PASS (${OUT}; ${EDGE_OUT})`);
process.exit(failures ? 1 : 0);
