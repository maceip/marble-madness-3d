// Two-browser, real WebSocket + MediaRecorder + ffmpeg share-card flow.
import { chromium } from 'playwright-core';

const BASE = (process.env.BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const human = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
const agentContext = await browser.newContext({ viewport: { width: 1100, height: 760 } });
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
const lobby = await human.evaluate(() => { game.mode = 'ai'; game.playerName = 'HUMAN'; game.go('connect'); return game.lobbyId; });
await agent.goto(`${BASE}/${lobby}`);
await agent.waitForFunction(() => window.webmcp?.callTool);
const tools = await agent.evaluate(() => window.webmcp.listTools().map((tool) => tool.name));
check('WebMCP exposes candidate review and share tools', tools.includes('get_share_candidate') && tools.includes('share'), tools.join(','));
await agent.evaluate(() => window.webmcp.callTool('set_name', { name: 'CLIPBOT' }));
await agent.evaluate(() => { window.__shareEvents = []; window.webmcp.subscribe((event, data) => window.__shareEvents.push({ event, data })); });
await Promise.all([
  human.waitForFunction(() => game.screen === 'race', null, { timeout: 25000 }),
  agent.waitForFunction(() => game.screen === 'race', null, { timeout: 25000 }),
]);
check('agent records the actual game canvas', await agent.evaluate(() => game.magicRecorder.review().status === 'recording'));
await agent.evaluate(() => window.webmcp.callTool('spin_trackball', { dx: 0.8, dy: 0.65, speed: 90 }));
await agent.waitForTimeout(1500);
await agent.evaluate(() => game.gameOver());
await agent.waitForFunction(() => game.magicRecorder.review().status === 'ready' || game.magicRecorder.review().status === 'error', null, { timeout: 12000 });
const candidate = await agent.evaluate(() => window.webmcp.callTool('get_share_candidate'));
check('race end becomes a reviewable share candidate', candidate.status === 'ready' && candidate.previewUrl && candidate.cardUrl, JSON.stringify(candidate));
check('share candidate is pushed through the WebMCP event stream', await agent.evaluate(() => window.__shareEvents.some((entry) => entry.event === 'share_candidate' && entry.data?.previewUrl === game.magicRecorder.review().previewUrl)));

if (candidate.status === 'ready') {
  const preview = await agent.request.get(candidate.previewUrl);
  const previewBytes = await preview.body();
  check('candidate contains a compact playable WebM', preview.ok() && /^video\/webm/.test(preview.headers()['content-type'] || '') && previewBytes.length > 64, `${preview.status()} ${previewBytes.length} bytes`);
  const end = Math.min(Number(candidate.duration) || 2, 3);
  const rendered = await agent.evaluate(({ end }) => window.webmcp.callTool('share', {
    worthSharing: true, start: 0, end, where: 'test card', caption: 'A tiny marble, a large disagreement.',
  }), { end });
  check('share renders a GIF and returns a card, without external posting', rendered.ok === true && rendered.gifUrl && rendered.cardUrl && /explicit user action/i.test(rendered.instruction || ''), JSON.stringify(rendered));
  if (rendered.gifUrl) {
    const gif = await agent.request.get(rendered.gifUrl);
    const gifBytes = await gif.body();
    check('rendered media is a real animated GIF', gif.ok() && gifBytes.subarray(0, 6).toString() === 'GIF89a', `${gif.status()} ${gifBytes.length} bytes`);
  }
  const removedSource = await agent.request.get(candidate.previewUrl);
  check('full-race source is deleted after clipping', removedSource.status() === 404, String(removedSource.status()));
  if (rendered.cardUrl) {
    const card = await agent.request.get(rendered.cardUrl);
    const html = await card.text();
    check('share card centers the GIF and links the production app', card.ok() && html.includes('<img ') && html.includes('marbles.secure.build'), `${card.status()}`);
    const cardPage = await agentContext.newPage();
    await cardPage.goto(rendered.cardUrl);
    const layout = await cardPage.evaluate(() => {
      const card = document.querySelector('.card')?.getBoundingClientRect();
      const media = document.querySelector('img')?.getBoundingClientRect();
      const url = document.querySelector('.url')?.getBoundingClientRect();
      return { card: card?.toJSON(), media: media?.toJSON(), url: url?.toJSON(), width: innerWidth };
    });
    check('rendered GIF is centered and app URL is below it', !!layout.card && !!layout.media && !!layout.url && Math.abs(layout.card.x + layout.card.width / 2 - layout.width / 2) < 2 && layout.url.top > layout.media.bottom, JSON.stringify(layout));
    await cardPage.screenshot({ path: BASE.startsWith('https://') ? 'artifacts/prod-magic-moment-card.png' : 'artifacts/magic-moment-card.png' });
    await cardPage.close();
  }
}

check('no browser errors', errors.length === 0, errors.slice(0, 4).join(' | '));
await browser.close();
console.log(failures ? `MAGIC MOMENT E2E: FAIL (${failures})` : 'MAGIC MOMENT E2E: PASS');
process.exit(failures ? 1 : 0);
