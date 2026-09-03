// Real browser + real lobby/WebSocket integration for the extension-free Chrome AI opponent.
// The only mocked boundary is Chrome's on-device LanguageModel, which is not provisioned in headless CI.
// Everything after its schema-constrained response uses the production WebMCP and multiplayer paths.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.MM_TEST_ORIGIN || 'http://127.0.0.1:3000';
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures++;
};

mkdirSync('artifacts/browser', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1180, height: 820 } });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
await context.addInitScript(() => {
  localStorage.setItem('mm_desktop_trackball_tutorial_v1', '1');
  window.__chromeAiTest = { created: 0, destroyed: 0, prompts: 0, constrained: 0, initialPrompt: '' };
  Object.defineProperty(globalThis, 'LanguageModel', {
    configurable: true,
    value: {
      async availability() { return 'available'; },
      async create(options) {
        window.__chromeAiTest.created++;
        window.__chromeAiTest.initialPrompt = options?.initialPrompts?.[0]?.content || '';
        return {
          async prompt(_input, promptOptions) {
            window.__chromeAiTest.prompts++;
            if (promptOptions?.responseConstraint?.properties?.actions) window.__chromeAiTest.constrained++;
            // Deliberately point away from Stage 1's next target; the runtime route guard must correct it.
            return JSON.stringify({ actions: [{ dx: 0, dy: -1, speed: 48, hold_ms: 100 }] });
          },
          destroy() { window.__chromeAiTest.destroyed++; },
        };
      },
    },
  });
});

const errors = [];
const page = await context.newPage();
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
await page.goto(BASE);
await page.waitForFunction(() => window.game && typeof window.game.go === 'function', null, { timeout: 20000 });
await page.evaluate(() => {
  window.game.mode = 'ai';
  window.game.playerName = 'HUMAN';
  window.game.go('connect');
});

check('old standalone Chrome download button stays hidden', await page.locator('#ui-chrome-ai').isHidden());
check('local-agent teaser waits 30 seconds', await page.locator('#ui-agent-teaser').isHidden());
check('clipboard callout uses the supplied icon', await page.locator('#ui-copy .ui-copy-icon').getAttribute('src') === '/assets/screens/parts/copybutton.png');
await page.locator('#ui-copy').click();
const copied = await page.evaluate(() => navigator.clipboard.readText());
check('clipboard copy is a direct embedded-browser instruction', /^Open this URL in your embedded browser: https?:\/\//.test(copied) && /WebMCP tools to join as Player 2/.test(copied));
await page.evaluate(() => { window.game.screens.idle = 31; });
await page.waitForSelector('#ui-agent-teaser:not([hidden])');
check('Slippy portal teaser appears after 30 seconds', await page.locator('#ui-agent-teaser').isVisible() && await page.locator('#ui-slippy').isVisible());
await page.locator('#ui-no-codex').click();
await page.waitForSelector('#ui-agent-picker:not([hidden])');
check('agent chooser exposes all requested runtimes', await page.locator('#ui-agent-option-chrome').isVisible() && await page.locator('#ui-agent-option-llama').isVisible() && await page.locator('#ui-agent-option-mtplx').isVisible());
check('unimplemented local bridges are explicitly disabled', !await page.locator('#ui-agent-option-llama').isEnabled() && !await page.locator('#ui-agent-option-mtplx').isEnabled());
check('supported desktop enables Chrome AI in the chooser', await page.locator('#ui-agent-option-chrome').isEnabled());
await page.screenshot({ path: 'artifacts/browser/chrome-ai-connect.png' });
await page.locator('#ui-agent-option-chrome').click();
await page.waitForFunction(() => window.__chromeAiTest.created === 1);
check('user click creates one local model session', await page.evaluate(() => window.__chromeAiTest.created === 1));
check('session receives the arcade-agent system prompt', await page.evaluate(() => /physical\s+arcade\s+trackball/i.test(window.__chromeAiTest.initialPrompt)));

await page.waitForFunction(() => document.querySelector('iframe.chrome-agent-frame')?.contentWindow?.webmcp, null, { timeout: 30000 });
const agentFrame = page.frames().find((frame) => /\/[0-9a-f-]{36}\?chrome_ai=1$/i.test(frame.url()));
check('same-origin agent iframe loaded', !!agentFrame, agentFrame?.url() || 'missing');
if (agentFrame) {
  await agentFrame.evaluate(() => {
    window.__mcpTraffic = [];
    window.addEventListener('mm:mcp-traffic', (event) => window.__mcpTraffic.push(event.detail));
  });
  await agentFrame.waitForFunction(() => window.game?.isAgentPage && window.game.playerName === 'CHROME AI', null, { timeout: 15000 });
  check('iframe joined as the existing AI role', await agentFrame.evaluate(() => window.game.isAgentPage && window.game.net.role === 'ai'));
  check('agent iframe is session-silent', await agentFrame.evaluate(() => window.game.sound.muted && (!window.game.sound.bgmEl || window.game.sound.bgmEl.volume === 0)));
  const agentRaced = await agentFrame.waitForFunction(() => window.game?.screen === 'race', null, { timeout: 25000 }).then(() => true).catch(() => false);
  check('agent iframe reaches the race', agentRaced, JSON.stringify(await agentFrame.evaluate(() => ({ screen: window.game?.screen, connected: window.game?.net.connected, players: [...(window.game?.net.players.values() || [])].map((p) => p.role) }))));
}
const humanRaced = await page.waitForFunction(() => window.game?.screen === 'race', null, { timeout: 25000 }).then(() => true).catch(() => false);
check('human reaches the race', humanRaced, JSON.stringify(await page.evaluate(() => ({ screen: window.game?.screen, connected: window.game?.net.connected, joined: window.game?.agentJoined, players: [...(window.game?.net.players.values() || [])].map((p) => p.role) }))));
await page.waitForFunction(() => window.__chromeAiTest.prompts > 0 && window.__chromeAiTest.constrained === window.__chromeAiTest.prompts, null, { timeout: 20000 });
check('every model decision uses a JSON response constraint', await page.evaluate(() => window.__chromeAiTest.prompts > 0 && window.__chromeAiTest.constrained === window.__chromeAiTest.prompts));

if (agentFrame) {
  await agentFrame.waitForFunction(() => window.game?.webmcp?.used && Math.hypot(window.game.input.trackball.wx, window.game.input.trackball.wy) > 0, null, { timeout: 10000 });
  const evidence = await agentFrame.evaluate(() => ({
    used: window.game.webmcp.used,
    rpm: Math.round(Math.hypot(window.game.input.trackball.wx, window.game.input.trackball.wy) * 9.55),
    traffic: window.__mcpTraffic,
  }));
  check('model output executes the real WebMCP trackball tool', evidence.used && evidence.rpm > 0, JSON.stringify({ rpm: evidence.rpm }));
  check('real call appears in MCP traffic', evidence.traffic.some((entry) => entry.phase === 'call' && entry.name === 'spin_trackball') && evidence.traffic.some((entry) => entry.phase === 'result' && entry.name === 'spin_trackball'));
  check('route guard corrects a model action aimed away from the next target', evidence.traffic.some((entry) => entry.phase === 'call' && entry.name === 'spin_trackball' && entry.payload?.dy > 0));
}
check('human sees the Chrome AI opponent', await page.waitForFunction(() => [...window.game.remoteInfo.values()].some((p) => p.role === 'ai' && p.name === 'CHROME AI'), null, { timeout: 10000 }).then(() => true).catch(() => false));
await page.locator('#vol-music').fill('0');
check('desktop music slider silences the human BGM', await page.evaluate(() => window.game.sound.musicVolume === 0 && (!window.game.sound.bgmEl || window.game.sound.bgmEl.volume === 0)));
await page.screenshot({ path: 'artifacts/browser/chrome-ai-human-race.png' });

// Simulate the iframe's normal post-race transition. The parent must stop polling, destroy the
// model session, and remove the hidden player frame without requiring the human to leave the page.
if (agentFrame) await agentFrame.evaluate(() => window.game.go('connect'));
await page.waitForFunction(() => window.__chromeAiTest.destroyed === 1 && !document.querySelector('iframe.chrome-agent-frame'));
check('race end destroys the model and iframe automatically', await page.evaluate(() => window.__chromeAiTest.destroyed === 1 && !document.querySelector('iframe.chrome-agent-frame')));
check('browser integration has no page or console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

const unsupportedContext = await browser.newContext({ viewport: { width: 1180, height: 820 } });
const unsupported = await unsupportedContext.newPage();
await unsupported.goto(BASE);
await unsupported.waitForFunction(() => typeof window.game?.go === 'function' && window.game.chromeAgent.availability !== 'unknown' && window.game.chromeAgent.availability !== 'checking', null, { timeout: 20000 });
await unsupported.evaluate(() => { window.game.mode = 'ai'; window.game.playerName = 'HUMAN'; window.game.go('connect'); window.game.screens.idle = 31; });
await unsupported.waitForSelector('#ui-agent-teaser:not([hidden])');
await unsupported.locator('#ui-no-codex').click();
check('unsupported Chrome keeps Codex flow and disables the unavailable runtime', await unsupported.locator('#ui-chrome-ai').isHidden() && !await unsupported.locator('#ui-agent-option-chrome').isEnabled());
await unsupportedContext.close();

await browser.close();
if (failures) process.exit(1);
console.log('\nCHROME AI WEBMCP E2E: PASS');
