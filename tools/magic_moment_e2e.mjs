// Two-browser, real WebSocket + MediaRecorder + ffmpeg share-card flow.
import { chromium } from 'playwright-core';

const BASE = (process.env.BASE || 'https://marbles.secure.build').replace(/\/$/, '');
if (BASE !== 'https://marbles.secure.build') {
  throw new Error('This acceptance test only runs against https://marbles.secure.build');
}
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
await agent.evaluate(() => {
  game.magicRecorder.noteHardCollision(4.2);
  game.magicRecorder.noteRemoteKnockoff();
});
await agent.evaluate(() => window.webmcp.callTool('spin_trackball', { dx: 0.8, dy: 0.65, speed: 90 }));
await agent.waitForTimeout(1500);
await agent.evaluate(() => game.gameOver());
await agent.waitForFunction(() => game.magicRecorder.review().status === 'ready' || game.magicRecorder.review().status === 'error', null, { timeout: 12000 });
const candidate = await agent.evaluate(() => window.webmcp.callTool('get_share_candidate'));
check('race end becomes a reviewable share candidate', candidate.status === 'ready' && candidate.previewUrl && candidate.cardUrl, JSON.stringify(candidate));
check('candidate carries bounded timestamp hints for clip review', Array.isArray(candidate.moments) && candidate.moments.length === 2 && candidate.moments.every((moment) => Number.isFinite(moment.at) && moment.at >= 0) && candidate.moments.some((moment) => moment.type === 'hard_collision') && candidate.moments.some((moment) => moment.type === 'ai_knocked_human'), JSON.stringify(candidate.moments));
check('private full-race preview advertises a bounded review window', Number.isFinite(Date.parse(candidate.expiresAt)) && Date.parse(candidate.expiresAt) > Date.now(), String(candidate.expiresAt || 'missing'));
check('share candidate is pushed through the WebMCP event stream', await agent.evaluate(() => window.__shareEvents.some((entry) => entry.event === 'share_candidate' && entry.data?.previewUrl === game.magicRecorder.review().previewUrl)));

if (candidate.status === 'ready') {
  const preview = await agent.request.get(candidate.previewUrl);
  const previewBytes = await preview.body();
  check('candidate contains a compact playable WebM', preview.ok() && /^video\/webm/.test(preview.headers()['content-type'] || '') && previewBytes.length > 64, `${preview.status()} ${previewBytes.length} bytes`);
  const outsider = await browser.newContext();
  const privatePreview = await outsider.request.get(candidate.previewUrl);
  const privateMeta = await outsider.request.get(`${BASE}/api/shares/${candidate.id}`);
  check('unreviewed source and metadata reject a cookie-less browser', privatePreview.status() === 403 && privateMeta.status() === 403, `${privatePreview.status()} / ${privateMeta.status()}`);
  await outsider.close();
  const end = Math.min(Number(candidate.duration) || 2, 3);
  const incomplete = await agent.evaluate(() => window.webmcp.callTool('share', { worthSharing: true }));
  check('agent must choose an exact clip window and destination', incomplete.ok === false && /start\/end window and destination/i.test(incomplete.error || ''), JSON.stringify(incomplete));
  const rejected = await agent.request.post(`${BASE}/api/shares/${candidate.id}/render`, {
    data: { worthSharing: true, start: -2, end: Number(candidate.duration) + 2, where: '' },
  });
  check('server rejects out-of-range clips instead of clamping into ffmpeg', rejected.status() === 400, `${rejected.status()} ${await rejected.text()}`);
  const stillPrivate = await agent.request.get(candidate.previewUrl);
  check('rejected render leaves the private source available for a corrected review', stillPrivate.ok(), String(stillPrivate.status()));
  const rendered = await agent.evaluate(({ end }) => window.webmcp.callTool('share', {
    worthSharing: true, start: 0, end, where: 'test card', caption: 'A tiny marble, a large disagreement.',
  }), { end });
  check('share renders a GIF and returns a card, without external posting', rendered.ok === true && rendered.gifUrl && rendered.cardUrl && /explicit user action/i.test(rendered.instruction || ''), JSON.stringify(rendered));
  const retried = await agent.evaluate(({ end }) => window.webmcp.callTool('share', {
    worthSharing: true, start: 0, end, where: 'retry test', caption: 'This retry must reuse the original card.',
  }), { end });
  check('share rendering is idempotent when an agent retries', retried.ok === true && retried.reused === true && retried.gifUrl === rendered.gifUrl && retried.cardUrl === rendered.cardUrl, JSON.stringify(retried));
  if (rendered.gifUrl) {
    const publicContext = await browser.newContext();
    const gif = await publicContext.request.get(rendered.gifUrl);
    const gifBytes = await gif.body();
    const publicCard = await publicContext.request.get(rendered.cardUrl);
    check('rendered media and card are public after review', gif.ok() && gifBytes.subarray(0, 6).toString() === 'GIF89a' && publicCard.ok(), `${gif.status()} ${gifBytes.length} bytes / ${publicCard.status()}`);
    await publicContext.close();
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
      return { card: card?.toJSON(), media: media?.toJSON(), url: url?.toJSON(), width: innerWidth, height: innerHeight };
    });
    check('rendered GIF card is centered and app URL is below it', !!layout.card && !!layout.media && !!layout.url && Math.abs(layout.card.x + layout.card.width / 2 - layout.width / 2) < 2 && Math.abs(layout.card.y + layout.card.height / 2 - layout.height / 2) < 2 && layout.url.top > layout.media.bottom, JSON.stringify(layout));
    await cardPage.screenshot({ path: BASE.startsWith('https://') ? 'artifacts/prod-magic-moment-card.png' : 'artifacts/magic-moment-card.png' });
    await cardPage.close();
    const responsiveSizes = [
      { id: 'mobile', width: 390, height: 844 },
      { id: 'fold-open', width: 790, height: 844 },
      { id: 'fold-land', width: 883, height: 736 },
    ];
    for (const size of responsiveSizes) {
      const responsiveContext = await browser.newContext({ viewport: size, isMobile: true, hasTouch: true });
      const responsiveCard = await responsiveContext.newPage();
      await responsiveCard.goto(rendered.cardUrl);
      const layout = await responsiveCard.evaluate(() => {
        const card = document.querySelector('.card')?.getBoundingClientRect();
        const media = document.querySelector('img')?.getBoundingClientRect();
        const url = document.querySelector('.url')?.getBoundingClientRect();
        return { card: card?.toJSON(), media: media?.toJSON(), url: url?.toJSON(), width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth };
      });
      check(`shared GIF card centers and fits ${size.id} without clipping`, !!layout.card && !!layout.media && !!layout.url && layout.card.left >= 0 && layout.card.right <= layout.width && layout.scrollWidth === layout.width && Math.abs(layout.card.y + layout.card.height / 2 - layout.height / 2) < 2 && layout.url.top > layout.media.bottom, JSON.stringify(layout));
      await responsiveCard.screenshot({ path: BASE.startsWith('https://') ? `artifacts/prod-magic-moment-card-${size.id}.png` : `artifacts/magic-moment-card-${size.id}.png` });
      await responsiveContext.close();
    }
  }
}

check('no browser errors', errors.length === 0, errors.slice(0, 4).join(' | '));
await browser.close();
console.log(failures ? `MAGIC MOMENT E2E: FAIL (${failures})` : 'MAGIC MOMENT E2E: PASS');
process.exit(failures ? 1 : 0);
