// Production-only Playwright coverage for the complete human <-> WebMCP lifecycle.
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'https://marbles.secure.build';
if (!/^https:\/\/marbles\.secure\.build\/?$/i.test(BASE)) throw new Error('This test only runs against https://marbles.secure.build');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const humanContext = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
const agentContext = await browser.newContext({ viewport: { width: 1100, height: 760 } });
await humanContext.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
const human = await humanContext.newPage();
const agent = await agentContext.newPage();
const errors = [];
for (const [who, page] of [['human', human], ['agent', agent]]) {
  page.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${who}: ${m.text()}`); });
}
let failed = 0;
const check = (name, pass, detail = '') => { console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`); if (!pass) failed++; };

await human.goto(BASE + '/');
await human.waitForFunction(() => window.game?.screens);
const worker = await human.evaluate(async () => {
  const registration = await navigator.serviceWorker.ready;
  await registration.update();
  const source = await (await fetch('/sw.js', { cache: 'no-store' })).text();
  const current = source.match(/const CACHE = '([^']+)'/)?.[1] || '';
  const keys = await caches.keys();
  return {
    current, keys,
    script: registration.active?.scriptURL || '',
    cachedDocument: !!(await caches.match('/')),
    cachedBundle: !!(await caches.match('/bundle.js')),
  };
});
check('service worker is current and does not cache UI code', !!worker.current && worker.script.endsWith('/sw.js') && worker.keys.filter((x) => x.startsWith('marbles-')).every((x) => x === worker.current) && !worker.cachedDocument && !worker.cachedBundle, JSON.stringify(worker));
const lobby = await human.evaluate(() => {
  game.mode = 'ai'; game.playerName = 'REX'; game.go('connect'); return game.lobbyId;
});
await human.waitForSelector('#ui-connect:not([hidden])');
await human.evaluate(() => game.screens.copyAgentLink());
const copied = await human.evaluate(() => navigator.clipboard.readText());
check('copy-to-Codex prompt is concise and complete', copied.split('\n').length <= 10 && copied.includes('set_name') && copied.includes('spin_trackball') && copied.includes('race_end'), `${copied.split('\n').length} lines`);
const mobileLayout = await human.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth, box: document.querySelector('.ui-connect-box')?.getBoundingClientRect().toJSON() }));
check('mobile connect screen is contained', mobileLayout.scrollWidth <= mobileLayout.innerWidth && mobileLayout.box?.left >= 0 && mobileLayout.box?.right <= mobileLayout.innerWidth + 1, JSON.stringify(mobileLayout));
await human.screenshot({ path: 'artifacts/prod-webmcp-connect-375x667.png' });
await agent.goto(`${BASE}/${lobby}`);
await agent.waitForFunction(() => window.webmcp?.callTool);

// Intentionally call before waiting for WebSocket open: this used to return OK and then revert to AGENT.
const named = await agent.evaluate(() => window.webmcp.callTool('set_name', { name: 'CODEX' }));
check('set_name reports queued or announced delivery', named.ok && /^queued|announced/.test(named.delivery), JSON.stringify(named));
check('queued name reaches human', await human.waitForFunction(() => [...game.net.players.values()].some((p) => p.name === 'CODEX'), null, { timeout: 6000 }).then(() => true).catch(() => false));

check('both enter the first race', await Promise.all([
  human.waitForFunction(() => game.screen === 'race', null, { timeout: 25000 }),
  agent.waitForFunction(() => game.screen === 'race', null, { timeout: 25000 }),
]).then(() => true).catch(() => false));
const ids = await Promise.all([human, agent].map((p) => p.evaluate(() => game.raceId)));
check('both share a non-empty race id', !!ids[0] && ids[0] === ids[1], ids.join(' / '));

const death = await agent.evaluate(async () => {
  const waiting = window.webmcp.callTool('wait_for_race_event', { timeout_ms: 5000 });
  const events = []; game.marble.die('void', events);
  for (const event of events) game['onMarbleEvent'](event);
  return waiting;
});
check('agent receives death event', death.event === 'death');
check('ordinary death remains in race', await agent.evaluate(() => game.screen === 'race'));
check('ordinary death automatically respawns', await agent.waitForFunction(() => game.marble.phase === 'alive' && game.deaths === 1, null, { timeout: 7000 }).then(() => true).catch(() => false));

// Agent loses first: the explicit peer event must move the human to rematch immediately.
await agent.evaluate(() => { game.timeLeft = 0.01; });
check('agent loss returns agent to lobby', await agent.waitForFunction(() => game.screen === 'connect', null, { timeout: 5000 }).then(() => true).catch(() => false));
check('agent loss opens human rematch', await human.waitForFunction(() => game.screen === 'rematch' && game.wonLast, null, { timeout: 5000 }).then(() => true).catch(() => false));

// Neither waiting screen may be dropped by the server's 20-second idle reap.
await human.waitForTimeout(22000);
const alive = await Promise.all([human, agent].map((p) => p.evaluate(() => ({ connected: game.net.connected, screen: game.screen }))));
check('heartbeat preserves both waiting sockets past 20s', alive.every((x) => x.connected), JSON.stringify(alive));

await human.evaluate(() => game.rematch());
check('same agent receives PLAY AGAIN', await Promise.all([
  human.waitForFunction(() => game.screen === 'intro' || game.screen === 'race', null, { timeout: 9000 }),
  agent.waitForFunction(() => game.screen === 'intro' || game.screen === 'race', null, { timeout: 9000 }),
]).then(() => true).catch(() => false));
const nextIds = await Promise.all([human, agent].map((p) => p.evaluate(() => game.raceId)));
check('rematch gets a new shared race id', nextIds[0] === nextIds[1] && nextIds[0] !== ids[0], nextIds.join(' / '));

await agent.evaluate((oldId) => game.net.sendRaceEnd({ raceId: oldId, result: 'timeup', stage: 1, score: 0, deaths: 0 }), ids[0]);
await human.waitForTimeout(400);
check('stale race-end cannot terminate a rematch', await human.evaluate(() => game.screen === 'intro' || game.screen === 'race'));

// Human loses: the agent must be released from the race and wait for the human.
await human.evaluate(() => game.gameOver());
check('human loss opens rematch', await human.evaluate(() => game.screen === 'rematch' && !game.wonLast));
check('human loss returns agent to lobby', await agent.waitForFunction(() => game.screen === 'connect', null, { timeout: 5000 }).then(() => true).catch(() => false));

// If the opponent is truly gone, PLAY AGAIN must not launch a solo race under a 2P label.
await agent.evaluate(() => game.net.leave());
await human.waitForFunction(() => !game.net.opponent('ai'), null, { timeout: 5000 });
await human.evaluate(() => game.rematch());
check('missing opponent returns human to connect instead of starting alone', await human.evaluate(() => game.screen === 'connect'));

// Timed-out WebMCP waits must clean themselves up.
await human.evaluate(async () => {
  for (let i = 0; i < 12; i++) await window.webmcp.callTool('wait_for_race_event', { timeout_ms: 20 });
});
check('timed-out event waits do not leak', await human.evaluate(() => game.webmcp.eventWaiters.length === 0));
check('no page or console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
console.log(failed ? `WEBMCP PROD E2E: FAIL (${failed})` : 'WEBMCP PROD E2E: PASS');
process.exit(failed ? 1 : 0);
