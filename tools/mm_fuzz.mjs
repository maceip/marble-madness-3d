#!/usr/bin/env node
/**
 * mm_fuzz.mjs — random-route collision fuzzer.
 *
 * Drops the marble at random floor pixels of a stage and drives it on "zany" routes (random headings,
 * speeds, direction changes) for a few seconds at a time, recording every death, stall and hard block with
 * the map pixel, the physics-trace reason and a heightfield probe. The output is a JSONL incident log that
 * tools/mm_fuzz_report.mjs ranks into "spots to look at".
 *
 *   node tools/mm_fuzz.mjs <stage> [--episodes 40] [--seconds 8] [--seed 1] [--worker w0]
 *
 *   BASE=http://127.0.0.1:3300           game to test (default: production https://marbles.secure.build)
 *   PLAYWRIGHT_SERVICE_URL=wss://...     Azure Playwright Workspaces endpoint (browsers run in the cloud)
 *   PLAYWRIGHT_SERVICE_ACCESS_TOKEN=...  bearer token for the service (Entra token or workspace access token)
 *   OUT=artifacts/fuzz                   output directory
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const stage = parseInt(args[0] || '1', 10);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const EPISODES = parseInt(opt('episodes', '40'), 10);
const SECONDS = parseFloat(opt('seconds', '8'));
const WORKER = opt('worker', 'w0');
let seed = parseInt(opt('seed', String(Date.now() % 100000)), 10);
const BASE = process.env.BASE || (process.env.PORT ? `http://127.0.0.1:${process.env.PORT}` : 'https://marbles.secure.build');
const OUT = path.resolve(process.env.OUT || 'artifacts/fuzz');
fs.mkdirSync(OUT, { recursive: true });
const outFile = path.join(OUT, `stage${stage}_${WORKER}.jsonl`);
const out = fs.createWriteStream(outFile, { flags: 'a' });
const emit = (rec) => { const line = JSON.stringify({ stage, worker: WORKER, seed, ...rec }); out.write(line + '\n'); console.log(line.slice(0, 300)); };

// deterministic PRNG so a worker's run can be replayed
let rs = seed >>> 0 || 1;
const rnd = () => { rs ^= rs << 13; rs >>>= 0; rs ^= rs >>> 17; rs ^= rs << 5; rs >>>= 0; return rs / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

// ---- browser: cloud (Azure Playwright Workspaces) or local ---------------------------------------------
let browser;
if (process.env.PLAYWRIGHT_SERVICE_URL) {
  const url = new URL(process.env.PLAYWRIGHT_SERVICE_URL);
  if (!url.searchParams.get('api-version')) url.searchParams.set('api-version', '2025-09-01');
  if (!url.searchParams.get('os')) url.searchParams.set('os', 'linux');
  url.searchParams.set('runId', process.env.RUN_ID || `mmfuzz-${new Date().toISOString().slice(0, 16)}`);
  browser = await chromium.connect(url.toString(), {
    timeout: 120000,
    headers: { Authorization: `Bearer ${process.env.PLAYWRIGHT_SERVICE_ACCESS_TOKEN}`, 'x-playwright-launch-options': JSON.stringify({ headless: true }) },
  });
  console.log(`connected to cloud browser (${url.host}) worker ${WORKER}`);
} else {
  browser = await chromium.launch({ channel: process.env.CHANNEL || 'chrome', headless: process.env.HEADLESS !== '0' });
}
const context = await browser.newContext({ viewport: { width: 640, height: 800 } });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
await context.addInitScript(() => { try { localStorage.setItem('mm_desktop_trackball_tutorial_v1', '1'); } catch {} });
await page.goto(`${BASE}/?stage=${stage}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.screen === 'race', null, { timeout: 60000 });
await page.evaluate(() => window.mmDebug.hazards && window.mmDebug.hazards(false));
const dims = await page.evaluate(() => ({ w: window.game.stage.width, h: window.game.stage.height, name: window.game.stage.name }));
console.log(`stage ${stage} "${dims.name}" ${dims.w}x${dims.h} on ${BASE}; ${EPISODES} episodes x ${SECONDS}s, seed ${seed}`);

const ev = (fn, arg) => page.evaluate(fn, arg);
const marble = () => ev(() => window.mmDebug.marble());
const keepClock = () => ev(() => window.mmDebug.clock && window.mmDebug.clock(300));

/** a random pixel that has a floor drawn under it (front-most floor), retried */
async function randomFloorPixel() {
  for (let i = 0; i < 400; i++) {
    const x = Math.floor(rnd() * dims.w), y = Math.floor(rnd() * dims.h);
    const p = await ev(([x, y]) => (window.mmDebug.pick(x, y)[0] || null), [x, y]);
    if (p) return { x, y, ...p };
  }
  return null;
}

const HEADINGS = [0, 45, 90, 135, 180, 225, 270, 315];
const summary = { episodes: 0, deaths: 0, stalls: 0, blocks: 0, sinks: 0, seconds: 0, redrops: 0 };

for (let ep = 0; ep < EPISODES; ep++) {
  await keepClock();
  // wait out a respawn / stage transition: alive, grounded and holding still (the respawn drop takes a moment)
  for (let i = 0; i < 80; i++) { const m = await marble(); if (m.phase === 'alive' && m.screen === 'race' && m.grounded && Math.hypot(m.vu, m.vv) < 0.2) break; await page.waitForTimeout(100); }
  await page.waitForTimeout(300);
  const m0 = await marble();
  if (m0.screen !== 'race') { emit({ ev: 'abort', why: `screen ${m0.screen}` }); break; }

  const start = await randomFloorPixel();
  if (!start) { emit({ ev: 'abort', why: 'no floor pixel found' }); break; }
  // a scripted slide / pipe (stage intros, chutes) keeps re-placing the marble: wait until it has let go
  for (let i = 0; i < 100; i++) { const m = await marble(); if (!m.slide && !m.inPipe) break; await page.waitForTimeout(100); }
  await ev(([x, y]) => window.mmDebug.teleport(x, y), [start.x, start.y]);
  await page.waitForTimeout(250);                       // let the marble settle onto the floor
  await ev(() => window.mmDebug.trace());               // drain
  let settled = await marble();
  if (settled.slide || settled.inPipe || Math.hypot(settled.sx - start.x, settled.sy - start.y) > 24) {
    // landed in a slide/pipe zone or got carried away: this drop is not a fair test, pick another spot
    for (let i = 0; i < 100; i++) { const m = await marble(); if (!m.slide && !m.inPipe) break; await page.waitForTimeout(100); }
    if (++summary.redrops < EPISODES * 3) { ep--; continue; }
  }
  // a floor we picked but cannot stand on: the drawn floor and the heightfield disagree
  if (!settled.grounded || Math.abs(settled.z - start.z) > 12) {
    emit({ ev: 'sink', sx: start.x, sy: start.y, z: start.z, floor: start.name, got: { z: settled.z, grounded: settled.grounded, sup: settled.sup }, why: 'teleported onto a drawn floor but did not land on it' });
    summary.sinks++;
  }

  // a zany route: a heading, a speed, re-rolled every 1-3 s; sometimes a burst of counter-spin
  let heading = pick(HEADINGS) + (rnd() - 0.5) * 40, speed = 20 + rnd() * 45, segEnd = 1 + rnd() * 2;
  const deathsAt = settled.deaths;
  let lastGround = { sx: settled.sx, sy: settled.sy, z: settled.z, sup: settled.sup };
  let slowSince = null, lastStallPx = null;
  const t0 = Date.now();
  let ended = null;
  while ((Date.now() - t0) / 1000 < SECONDS) {
    const el = (Date.now() - t0) / 1000;
    if (el > segEnd) { heading = pick(HEADINGS) + (rnd() - 0.5) * 40; speed = 20 + rnd() * 45; segEnd = el + 1 + rnd() * 2; if (rnd() < 0.2) speed = 70; }
    const dx = Math.cos(heading * Math.PI / 180), dy = Math.sin(heading * Math.PI / 180);
    await ev(([dx, dy, sp]) => window.mmDebug.spin(dx, dy, sp), [dx, dy, speed]);
    await page.waitForTimeout(100);
    const m = await marble();
    const tr = await ev(() => window.mmDebug.trace());
    for (const e of tr) {
      if (e.ev === 'block') { summary.blocks++; }
      if (e.ev === 'die') {
        summary.deaths++;
        // what is DRAWN just past the point where the marble left the floor, along its heading? If the art shows a floor
        // at about the same height there, the collision disagrees with the picture -> suspect. Black void -> a real edge.
        const ahead = await ev(([sx, sy, dx, dy]) => [4, 8, 12, 18].map((d) => { const p = window.mmDebug.pick(Math.round(sx + dx * d), Math.round(sy + dy * d))[0]; return p ? { d, z: p.z, name: p.name } : { d, z: null }; }), [lastGround.sx, lastGround.sy, dx, dy]);
        const suspect = ahead.some((a) => a.z !== null && Math.abs(a.z - lastGround.z) <= 24);
        emit({ ev: 'die', sx: e.sx, sy: e.sy, z: e.z, why: e.why, from: lastGround, ahead, suspect, route: { heading: Math.round(heading), speed: Math.round(speed) }, tEp: +el.toFixed(1) });
        ended = 'die';
      }
    }
    if (ended) break;
    if (m.grounded) lastGround = { sx: m.sx, sy: m.sy, z: m.z, sup: m.sup };
    if (m.screen !== 'race') { ended = 'screen'; break; }
    // stall: spinning hard, grounded, not dizzy, not moving
    const sp = Math.hypot(m.vu, m.vv);
    if (m.grounded && m.dizzy <= 0 && sp < 0.3 && speed >= 20) {
      slowSince ??= el;
      if (el - slowSince > 1.2) {
        const px = `${Math.round(m.sx / 4)},${Math.round(m.sy / 4)}`;
        if (px !== lastStallPx) {
          const probe = await ev(() => window.mmDebug.probe());
          summary.stalls++;
          emit({ ev: 'stall', sx: m.sx, sy: m.sy, z: m.z, sup: m.sup, blocks: probe && probe.blocks, wall: probe && probe.wall, route: { heading: Math.round(heading), speed: Math.round(speed) }, tEp: +el.toFixed(1) });
          lastStallPx = px;
        }
        heading += 90 + rnd() * 180; slowSince = null;   // turn away and keep going
      }
    } else slowSince = null;
  }
  await ev(() => window.mmDebug.grab && window.mmDebug.grab());
  summary.episodes++; summary.seconds += SECONDS;
  if (pageErrors.length) { emit({ ev: 'pageerror', why: pageErrors.splice(0).join(' | ') }); }
}

emit({ ev: 'summary', ...summary, base: BASE });
out.end();
await browser.close();
