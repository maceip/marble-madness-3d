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
async function captureAnimatedCard(page, file) {
  await page.waitForTimeout(1400); // title lead-in is 0.9 s; capture the gameplay segment
  // Chromium can omit non-animated sibling layers from a screenshot while an
  // animated GIF is compositing. Snapshot the visible GIF frame, freeze that
  // exact frame in the loaded production card, then capture all card chrome.
  const image = page.locator('.card img');
  const frame = await image.screenshot({ type: 'png' });
  await image.evaluate((element, src) => { element.src = src; }, `data:image/png;base64,${frame.toString('base64')}`);
  await page.evaluate(async () => {
    const card = document.querySelector('.card');
    if (card instanceof HTMLElement) {
      card.style.transform = 'translateZ(0) scale(0.9999)';
      card.style.filter = 'brightness(1)';
      void card.offsetHeight;
      card.style.transform = 'translateZ(0) scale(1)';
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.screenshot({ path: file });
}

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
const expectedPrompt = `Open this URL in your embedded browser: ${BASE.replace(/\/$/, '')}/${lobby}\nUse the page's WebMCP tools to join as Player 2 and race me.`;
check('copy-to-Codex prompt is the exact direct instruction', copied === expectedPrompt, `${copied.split('\n').length} lines`);
const mobileLayout = await human.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth, box: document.querySelector('.ui-connect-box')?.getBoundingClientRect().toJSON() }));
check('mobile connect screen is contained', mobileLayout.scrollWidth <= mobileLayout.innerWidth && mobileLayout.box?.left >= 0 && mobileLayout.box?.right <= mobileLayout.innerWidth + 1, JSON.stringify(mobileLayout));
const cradle = await human.evaluate(() => {
  const loader = document.querySelector('.ui-cradle-loader');
  const image = document.querySelector('.ui-cradle-loader img');
  const left = document.querySelector('.ui-cradle-left');
  const right = document.querySelector('.ui-cradle-right');
  const animations = [left, right].map((part) => part?.getAnimations()[0]);
  for (const animation of animations) if (animation) animation.currentTime = 0;
  const releasedRight = [getComputedStyle(left).opacity, getComputedStyle(right).opacity, getComputedStyle(right).transform];
  for (const animation of animations) if (animation) animation.currentTime = 880;
  const releasedLeft = [getComputedStyle(left).opacity, getComputedStyle(right).opacity, getComputedStyle(left).transform];
  return {
    rect: loader?.getBoundingClientRect().toJSON(),
    loaded: image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
    releasedRight, releasedLeft,
  };
});
check('Newton cradle transfers motion between independently swinging outer marbles', cradle.loaded && cradle.rect?.left >= 0 && cradle.rect?.right <= 376 && cradle.releasedRight[0] === '0' && cradle.releasedRight[1] === '1' && cradle.releasedLeft[0] === '1' && cradle.releasedLeft[1] === '0' && cradle.releasedRight[2] !== cradle.releasedLeft[2], JSON.stringify(cradle));
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
  game.net.onBump?.(6, -3, 'human');
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
await agent.waitForFunction(() => ['ready', 'error'].includes(game.magicRecorder.review().status), null, { timeout: 12000 });
const knockoffCandidate = await agent.evaluate(() => window.webmcp.callTool('get_share_candidate'));
const knockoffMark = knockoffCandidate.moments?.find((moment) => moment.type === 'human_knocked_ai');
check('received human bump plus AI death becomes a timestamped knockoff', knockoffCandidate.status === 'ready' && Number.isFinite(knockoffMark?.at), JSON.stringify(knockoffCandidate));
if (knockoffCandidate.status === 'ready' && Number.isFinite(knockoffMark?.at)) {
  const start = Math.max(0, knockoffMark.at - 0.5);
  const end = Math.min(knockoffCandidate.duration, start + 3);
  const shared = await agent.evaluate(({ start, end }) => window.webmcp.callTool('share', {
    worthSharing: true, start, end, where: 'share card', caption: 'Human sends CODEX over the edge.',
  }), { start, end });
  check('timestamped human-vs-AI knockoff renders a share card', shared.ok === true && shared.gifUrl && shared.cardUrl, JSON.stringify(shared));
  if (shared.cardUrl) {
    console.log(`SHARE CARD  ${shared.cardUrl}`);
    const sharePage = await agentContext.newPage();
    sharePage.on('pageerror', (e) => errors.push(`share: ${e.message}`));
    sharePage.on('console', (m) => { if (m.type() === 'error') errors.push(`share: ${m.text()}`); });
    await sharePage.goto(shared.cardUrl);
    await captureAnimatedCard(sharePage, 'artifacts/prod-human-knocks-ai-card.png');
    await sharePage.close();
  }
}

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

const reciprocalRace = await Promise.all([
  human.waitForFunction(() => game.screen === 'race' && game.marble.phase === 'alive' && !game.marble.slide, null, { timeout: 25000 }),
  agent.waitForFunction(() => {
    const opponent = game.net.opponent('human');
    return game.screen === 'race'
      && game.marble.phase === 'alive'
      && !game.marble.slide
      && opponent?.phase === 'alive'
      && game.remotePhase.get(opponent.id) === 'alive';
  }, null, { timeout: 25000 }),
]).then(() => true).catch(() => false);
check('rematch reaches a settled live race for reciprocal collision', reciprocalRace);
const agentCollision = reciprocalRace ? await agent.evaluate(async () => {
  const opponent = game.net.opponent('human');
  if (!opponent) return { ok: false, error: 'human opponent missing' };
  const before = { destroyed: game.aiDestroyed, dizzied: game.aiDizzied };
  game.marble.place(opponent.u - 0.5, opponent.v, opponent.z);
  game.marble.vu = 10; game.marble.vv = -2;
  const until = performance.now() + 2500;
  while (performance.now() < until) {
    if (game.bumpedIds.has(opponent.id) && game.bumpClock > 0) {
      return { ok: true, id: opponent.id, before, dizzied: game.aiDizzied, bumpClock: game.bumpClock };
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return { ok: false, id: opponent.id, before, dizzied: game.aiDizzied, bumpClock: game.bumpClock };
}) : { ok: false, error: 'rematch never reached settled live state' };
check('agent marble makes a real networked collision with human', agentCollision.ok, JSON.stringify(agentCollision));
if (agentCollision.ok) {
  await human.evaluate(() => {
    const events = []; game.marble.die('void', events);
    for (const event of events) game['onMarbleEvent'](event);
  });
}
check('AI collision followed by human death is attributed to AI', agentCollision.ok && await agent.waitForFunction(
  (beforeDestroyed) => game.aiDestroyed > beforeDestroyed && game.magicRecorder.moments?.some((moment) => moment.type === 'ai_knocked_human'),
  agentCollision.before?.destroyed ?? 0,
  { timeout: 5000 },
).then(() => true).catch(() => false));

// Human loses: the agent must be released from the race and wait for the human.
await human.evaluate(() => game.gameOver());
check('human loss opens rematch', await human.evaluate(() => game.screen === 'rematch' && !game.wonLast));
check('human loss returns agent to lobby', await agent.waitForFunction(() => game.screen === 'connect', null, { timeout: 5000 }).then(() => true).catch(() => false));
await agent.waitForFunction(() => ['ready', 'error'].includes(game.magicRecorder.review().status), null, { timeout: 12000 });
const aiKnockoffCandidate = await agent.evaluate(() => window.webmcp.callTool('get_share_candidate'));
const aiKnockoffMark = aiKnockoffCandidate.moments?.find((moment) => moment.type === 'ai_knocked_human');
check('AI-on-human knockoff survives into completed-race review', aiKnockoffCandidate.status === 'ready' && Number.isFinite(aiKnockoffMark?.at) && /AI knocked the human off/i.test(aiKnockoffCandidate.reason || ''), JSON.stringify(aiKnockoffCandidate));
const attributedCollision = aiKnockoffCandidate.moments?.find((moment) => moment.type === 'hard_collision');
check('hard collision records which side carried the impact', /^(ai|human|mutual) impact \d/i.test(attributedCollision?.detail || ''), JSON.stringify(attributedCollision));
if (aiKnockoffCandidate.status === 'ready' && Number.isFinite(aiKnockoffMark?.at)) {
  const start = Math.max(0, aiKnockoffMark.at - 0.5);
  const end = Math.min(aiKnockoffCandidate.duration, start + 3);
  const shared = await agent.evaluate(({ start, end }) => window.webmcp.callTool('share', {
    worthSharing: true, start, end, where: 'share card', caption: 'CODEX returns the favor.',
  }), { start, end });
  check('timestamped AI-vs-human knockoff renders a share card', shared.ok === true && shared.gifUrl && shared.cardUrl, JSON.stringify(shared));
  if (shared.cardUrl) {
    console.log(`SHARE CARD  ${shared.cardUrl}`);
    const sharePage = await agentContext.newPage();
    sharePage.on('pageerror', (e) => errors.push(`share: ${e.message}`));
    sharePage.on('console', (m) => { if (m.type() === 'error') errors.push(`share: ${m.text()}`); });
    await sharePage.goto(shared.cardUrl);
    await captureAnimatedCard(sharePage, 'artifacts/prod-ai-knocks-human-card.png');
    await sharePage.close();
  }
}

// A human can hammer PLAY AGAIN before the prior MediaRecorder upload finishes.
// Prove that the completed race stays addressable while the rematch records into
// a separate session, then exercise the private decline-and-delete path.
await human.evaluate(() => game.rematch());
check('third race starts for rapid-rematch recorder test', await Promise.all([
  human.waitForFunction(() => game.screen === 'race', null, { timeout: 25000 }),
  agent.waitForFunction(() => game.screen === 'race' && game.magicRecorder.recorder?.state === 'recording', null, { timeout: 25000 }),
]).then(() => true).catch(() => false));
await agent.evaluate(() => {
  window.__rapidShareCandidates = [];
  window.webmcp.subscribe((event, data) => {
    if (event === 'share_candidate') window.__rapidShareCandidates.push(data);
  });
  game.magicRecorder.noteHardCollision(7.7);
  game.gameOver();
});
await Promise.all([
  human.waitForFunction(() => game.screen === 'rematch', null, { timeout: 5000 }),
  agent.waitForFunction(() => game.screen === 'connect', null, { timeout: 5000 }),
]);
await human.evaluate(() => game.rematch());
check('immediate fourth race records while third race uploads', await Promise.all([
  human.waitForFunction(() => game.screen === 'race', null, { timeout: 25000 }),
  agent.waitForFunction(() => game.screen === 'race' && game.magicRecorder.recorder?.state === 'recording', null, { timeout: 25000 }),
]).then(() => true).catch(() => false));
const rapidCandidate = await agent.waitForFunction(() => window.__rapidShareCandidates?.[0], null, { timeout: 12000 }).then((handle) => handle.jsonValue()).catch(() => null);
check('prior race candidate survives the live rematch recorder', !!rapidCandidate?.id && await agent.evaluate(() => game.magicRecorder.recorder?.state === 'recording'), JSON.stringify(rapidCandidate));
if (rapidCandidate?.id) {
  const recovered = await agent.evaluate(() => window.webmcp.callTool('get_share_candidate'));
  check('missed push is recoverable from the unreviewed candidate queue', recovered.id === rapidCandidate.id, JSON.stringify(recovered));
  const exact = await agent.evaluate((candidateId) => window.webmcp.callTool('get_share_candidate', { candidateId }), rapidCandidate.id);
  check('candidate ID selects the exact overlapping race', exact.id === rapidCandidate.id && exact.raceId === rapidCandidate.raceId, JSON.stringify(exact));
  const declined = await agent.evaluate((candidateId) => window.webmcp.callTool('share', { candidateId, worthSharing: false }), rapidCandidate.id);
  check('agent can decline a non-magic race without rendering or posting', declined.ok === true && declined.shared === false && /deleted/i.test(declined.instruction || ''), JSON.stringify(declined));
  const deleted = await agent.request.get(rapidCandidate.previewUrl);
  check('declining deletes the private full-race recording', deleted.status() === 404, String(deleted.status()));
}
await agent.evaluate(() => game.gameOver());
await agent.waitForFunction(() => window.__rapidShareCandidates?.length >= 2, null, { timeout: 12000 }).catch(() => null);
const lastRapidId = await agent.evaluate(() => window.__rapidShareCandidates?.at(-1)?.id || '');
if (lastRapidId) await agent.evaluate((candidateId) => window.webmcp.callTool('share', { candidateId, worthSharing: false }), lastRapidId);

await human.waitForFunction(() => game.screen === 'rematch', null, { timeout: 5000 });
await human.evaluate(() => game.rematch());
check('fifth race starts for recorder fault cleanup', await Promise.all([
  human.waitForFunction(() => game.screen === 'race', null, { timeout: 25000 }),
  agent.waitForFunction(() => game.screen === 'race' && game.magicRecorder.recorder?.state === 'recording', null, { timeout: 25000 }),
]).then(() => true).catch(() => false));
await agent.evaluate(() => {
  window.__faultStream = game.magicRecorder.stream;
  game.magicRecorder.recorder.stop();
});
const faultCleanup = await agent.waitForFunction(() => game.magicRecorder.candidate.status === 'error' && game.magicRecorder.recorder === null, null, { timeout: 4000 }).then(() => agent.evaluate(() => ({
  candidate: game.magicRecorder.candidate,
  tracks: [...(window.__faultStream?.getTracks() || [])].map((track) => track.readyState),
  event: game.webmcp.lastEvent,
}))).catch(() => null);
check('unexpected MediaRecorder stop ends tracks and notifies WebMCP', !!faultCleanup && /stopped unexpectedly/i.test(faultCleanup.candidate?.error || '') && faultCleanup.tracks.length > 0 && faultCleanup.tracks.every((state) => state === 'ended') && faultCleanup.event?.event === 'share_error', JSON.stringify(faultCleanup));
await agent.evaluate(() => game.gameOver());
await human.waitForFunction(() => game.screen === 'rematch', null, { timeout: 5000 });

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
