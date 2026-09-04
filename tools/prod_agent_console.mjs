// Production-only Playwright acceptance for the permanent desktop WebMCP vanity console.
import { chromium } from 'playwright-core';
import crypto from 'node:crypto';

const BASE = process.env.BASE || 'https://marbles.secure.build';
if (!/^https:\/\/marbles\.secure\.build\/?$/i.test(BASE)) throw new Error('This test only runs against https://marbles.secure.build');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
let failed = 0;
const check = (name, pass, detail = '') => { console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`); if (!pass) failed++; };
const lobby = crypto.randomUUID();

const agentContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const agent = await agentContext.newPage();
await agent.addInitScript(() => {
  window.__registeredSiteTools = [];
  Object.defineProperty(document, 'modelContext', {
    configurable: true,
    value: { registerTool(tool) { window.__registeredSiteTools.push(tool); }, registerResource() {} },
  });
});
const errors = [];
agent.on('pageerror', (error) => errors.push(error.message));
agent.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
await agent.goto(`${BASE}/${lobby}`);
await agent.waitForFunction(() => window.game?.screens && window.webmcp?.callTool);
await agent.waitForSelector('#agent-console:not([hidden])');

const shell = await agent.evaluate(() => ({
  active: document.body.classList.contains('agent-console-active'),
  consoleVisible: getComputedStyle(document.getElementById('agent-console')).display !== 'none',
  gameHidden: getComputedStyle(document.getElementById('game')).display === 'none',
  humanUiHidden: getComputedStyle(document.getElementById('ui-root')).display === 'none',
  trackballVisible: getComputedStyle(document.getElementById('trackball-container')).display === 'flex',
}));
check('desktop UUID route shows only the permanent agent console', Object.values(shell).every(Boolean), JSON.stringify(shell));

await agent.evaluate(() => {
  window.__agentClassHistory = [];
  const host = document.getElementById('agent-console');
  new MutationObserver(() => window.__agentClassHistory.push(host.className)).observe(host, { attributes: true, attributeFilter: ['class'] });
});
const trackballBefore = await agent.locator('#trackball').screenshot();
await agent.evaluate(async () => {
  const call = (name, args = {}) => window.__registeredSiteTools.find((tool) => tool.name === name).execute(args);
  await call('set_name', { name: 'VANITY' });
  await call('spin_trackball', { dx: 1, dy: -0.25, speed: 72 });
  await call('get_game_state', {});
  await window.webmcp.readResource('game://state');
  try { await window.webmcp.callTool('not_a_tool', {}); } catch { /* expected terminal error traffic */ }
});
await agent.waitForTimeout(250);
const trackballAfter = await agent.locator('#trackball').screenshot();
const traffic = await agent.evaluate(() => ({
  lines: [...document.querySelectorAll('.agent-log-line')].map((el) => el.getAttribute('aria-label') || ''),
  classes: window.__agentClassHistory,
  speed: Math.hypot(game.input.trackball.wx, game.input.trackball.wy),
}));
check('terminal renders real calls, results, resources, and errors',
  traffic.lines.some((x) => x.includes('> SPIN_TRACKBALL'))
    && traffic.lines.some((x) => x.includes('< SPIN_TRACKBALL'))
    && traffic.lines.some((x) => x.includes('@ READ GAME://STATE'))
    && traffic.lines.some((x) => x.includes('! ERROR NOT_A_TOOL')), traffic.lines.join(' | '));
check('directional call pulses through flux both ways', traffic.classes.some((x) => x.includes('pulse-to-ball') && x.includes('pulse-spin')) && traffic.classes.some((x) => x.includes('pulse-to-terminal') && x.includes('pulse-spin')), traffic.classes.join(' | '));
check('directional MCP traffic spins the rendered trackball', traffic.speed > 0, String(traffic.speed));
check('site-tool spin visibly moves the trackball canvas', !trackballBefore.equals(trackballAfter));

// A human starts the race, but the agent's visible surface must not switch to any human/race screen.
const humanContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const human = await humanContext.newPage();
await human.goto(BASE + '/'); await human.waitForFunction(() => window.game?.screens);
await human.evaluate((id) => { game.mode = 'ai'; game.lobbyId = id; game.playerName = 'HUMAN'; game.go('connect'); }, lobby);
check('both peers enter the race underneath the console', await Promise.all([
  human.waitForFunction(() => game.screen === 'race', null, { timeout: 25000 }),
  agent.waitForFunction(() => game.screen === 'race', null, { timeout: 25000 }),
]).then(() => true).catch(() => false));
check('agent console remains unchanged through race transition', await agent.evaluate(() => !document.getElementById('agent-console').hidden && document.body.classList.contains('agent-console-active') && getComputedStyle(document.getElementById('game')).display === 'none'));

await agent.screenshot({ path: '/tmp/prod-agent-console.png' });

// Codex may render its built-in browser in a narrow desktop pane; fine-pointer panes still need both surfaces.
const narrowContext = await browser.newContext({ viewport: { width: 600, height: 800 } });
const narrowAgent = await narrowContext.newPage();
await narrowAgent.goto(`${BASE}/${crypto.randomUUID()}`); await narrowAgent.waitForFunction(() => window.game?.screens);
const narrow = await narrowAgent.evaluate(() => ({
  active: document.body.classList.contains('agent-console-active'),
  consoleVisible: getComputedStyle(document.getElementById('agent-console')).display !== 'none',
  trackballVisible: getComputedStyle(document.getElementById('trackball-container')).display === 'flex',
  terminalVisible: document.getElementById('agent-terminal-log').getBoundingClientRect().height > 0,
}));
check('narrow fine-pointer agent pane keeps xterm and trackball visible', Object.values(narrow).every(Boolean), JSON.stringify(narrow));

const edgeContext = await browser.newContext({ viewport: { width: 900, height: 700 } });
const edgeAgent = await edgeContext.newPage();
await edgeAgent.goto(`${BASE}/${crypto.randomUUID()}`); await edgeAgent.waitForFunction(() => window.game?.screens);
check('900px agent pane has no CSS/JS breakpoint split', await edgeAgent.evaluate(() => document.body.classList.contains('agent-console-active') && getComputedStyle(document.getElementById('agent-console')).display !== 'none' && getComputedStyle(document.getElementById('trackball-container')).display === 'flex'));

// The vanity is intentionally desktop agent-only.
const mobileAgentContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const mobileAgent = await mobileAgentContext.newPage();
await mobileAgent.goto(`${BASE}/${crypto.randomUUID()}`); await mobileAgent.waitForFunction(() => window.game?.screens);
check('mobile agent route does not activate desktop vanity', await mobileAgent.evaluate(() => document.getElementById('agent-console').hidden && !document.body.classList.contains('agent-console-active')));
check('human root never activates agent vanity', await human.evaluate(() => document.getElementById('agent-console').hidden && !document.body.classList.contains('agent-console-active')));
check('agent console has no page or console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
console.log(failed ? `PROD AGENT CONSOLE: FAIL (${failed})` : 'PROD AGENT CONSOLE: PASS');
process.exit(failed ? 1 : 0);
