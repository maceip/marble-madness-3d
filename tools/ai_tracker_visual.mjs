// Real two-browser regression for the human-side AI marble callout.
// Defaults to local development; set BASE=https://marbles.secure.build for release proof.
import { chromium } from 'playwright-core';

const BASE = (process.env.BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');
const OUT = process.env.OUT || 'artifacts/ai-tracker-mobile.png';
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
check('no browser errors', errors.length === 0, errors.slice(0, 4).join(' | '));
await browser.close();
console.log(failures ? `AI TRACKER: FAIL (${failures})` : `AI TRACKER: PASS (${OUT})`);
process.exit(failures ? 1 : 0);
