// Agent-side lobby regression, under the production CSP. Extends the flow of test_lobby.mjs with the two things
// the fail_mcp.mov recording exposed: the agent's own simulation must advance even when its rAF is throttled
// (its embedded browser barely paints), and after a race it must return to the lobby, never the human menus.
import { chromium } from 'playwright-core';
const CSP = "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws: wss:; worker-src 'self' blob:";
const base = process.env.BASE || 'http://127.0.0.1:3000';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const human = await (await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true })).newPage();
const agent = await (await browser.newContext()).newPage();
for (const p of [human, agent]) p.on('pageerror', (e) => console.log('[pageerror]', e.message));  // prod serves its own CSP + wss; no injection
let failed = 0; const check = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  ' + d : ''}`); if (!ok) failed++; };

await human.goto(base + '/');
await human.waitForFunction(() => window.game && typeof window.game.go === 'function', null, { timeout: 20000 });
// drive the human straight to the Player-vs-AI connect screen (the exact menu keystrokes are covered elsewhere;
// what the lobby depends on is mode=ai + go('connect'), which opens the human's WebSocket)
const lobby = await human.evaluate(() => { const g = window.game; g.mode = 'ai'; g.isAI = false; g.playerName = 'REX'; g.go('connect'); return g.lobbyId; });
check('human on connect screen', await human.waitForFunction(() => window.game.screen === 'connect' && window.game.net.connected, null, { timeout: 12000 }).then(() => true).catch(() => false));

await agent.goto(`${base}/${lobby}`);
await agent.waitForFunction(() => window.game && typeof window.game.go === 'function', null, { timeout: 20000 });
check('agent page identifies as the AI in this lobby', await agent.evaluate((l) => window.game.isAgentPage && window.game.mode === 'ai' && window.game.lobbyId === l, lobby));
check('agent shows the waiting screen, not the copy UI', await agent.evaluate(() => window.game.screen === 'connect'));

for (const [n, p] of [['human', human], ['agent', agent]]) check(`${n} reaches the race`, await p.waitForFunction(() => window.game.screen === 'race', null, { timeout: 25000 }).then(() => true).catch(() => false));

// throttle the agent's rAF to ~1 fps (its embedded browser barely paints) and confirm its marble still advances
await agent.evaluate(() => { const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => setTimeout(() => raf(cb), 1000); });
await agent.evaluate(() => window.webmcp.callTool('spin_trackball', { dx: 0, dy: 1, speed: 80 }));
const b = await agent.evaluate(() => ({ u: window.game.marble.u, v: window.game.marble.v }));
await agent.waitForTimeout(2500);
const moved = await agent.evaluate((b0) => +Math.hypot(window.game.marble.u - b0.u, window.game.marble.v - b0.v).toFixed(1), b);
check('agent marble advances with rAF throttled to 1 fps', moved > 1, `moved ${moved} tiles`);
await human.waitForTimeout(600);
const seen = await human.evaluate(() => { const o = window.game.others[0]; return o ? +Math.hypot(o.vu, o.vv).toFixed(1) : -1; });
check('human sees the agent marble in motion', seen > 0, `opponent speed ${seen}`);

// end the race on the agent side and confirm it returns to the lobby, never the human menus
await agent.evaluate(() => { window.game.timeLeft = 0.05; });
const back = await agent.waitForFunction(() => window.game.screen === 'connect', null, { timeout: 12000 }).then(() => true).catch(() => false);
check('agent returns to the lobby after game over', back, 'screen ' + await agent.evaluate(() => window.game.screen));
check('agent never entered a human menu', await agent.evaluate(() => window.game.screen === 'connect' || window.game.screen === 'gameover'));

await browser.close();
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log('lobby agent flow OK');
