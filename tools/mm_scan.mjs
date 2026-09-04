#!/usr/bin/env node
/**
 * mm_scan.mjs — exhaustive picture-vs-collision consistency scan (no randomness, no marble).
 *
 * For every map pixel that has a floor DRAWN under it (game.pickAtPixel), ask the heightfield what a marble
 * centred there would get:
 *   HOLE  — no support within 12 units of the drawn height: the player sees floor, the marble falls through
 *   WALL  — a marble at the drawn height is blocked on that very pixel although every neighbouring pixel
 *           is drawn as floor too (an invisible wall inside a floor). Blocks at the border of a floor are
 *           the normal wall/cliff edge and are not reported.
 * Findings are clustered and printed with map pixels, ready to check against the stage picture.
 *
 *   node tools/mm_scan.mjs <stage> [--step 2] [--top 20]        BASE=http://127.0.0.1:3300 to scan a local build
 */
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const stage = parseInt(args[0] || '1', 10);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const STEP = parseInt(opt('step', '2'), 10), TOP = parseInt(opt('top', '20'), 10);
const BASE = process.env.BASE || (process.env.PORT ? `http://127.0.0.1:${process.env.PORT}` : 'https://marbles.secure.build');

const browser = await chromium.launch({ channel: process.env.CHANNEL || 'chrome', headless: true });
const page = await (await browser.newContext()).newPage();
await page.addInitScript(() => { try { localStorage.setItem('mm_desktop_trackball_tutorial_v1', '1'); } catch {} });
await page.goto(`${BASE}/?stage=${stage}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.screen === 'race', null, { timeout: 60000 });

const res = await page.evaluate((STEP) => {
  const g = window.game, st = g.stage, hm = st.heightmap;
  const eng = window.mmDebug;
  const W = st.width, H = st.height;
  const holes = [], walls = [];
  let floorPx = 0;
  const drawn = (x, y) => { const p = g.pickAtPixel(x, y)[0]; return p || null; };
  for (let y = 0; y < H; y += STEP) {
    for (let x = 0; x < W; x += STEP) {
      const p = drawn(x, y);
      if (!p) continue;
      floorPx++;
      const sup = hm.supportZ(p.u, p.v, p.z + 12);
      if (Number.isNaN(sup) || Math.abs(sup - p.z) > 12) { holes.push({ x, y, z: Math.round(p.z), name: p.name, got: Number.isNaN(sup) ? null : Math.round(sup) }); continue; }
      const why = hm.blockReason(p.u, p.v, p.z + 2);
      if (why) {
        // interior only: all 8 neighbours (STEP*2 away) are drawn floor at about the same height
        let interior = true;
        for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) {
          const q = drawn(x + dx * STEP * 2, y + dy * STEP * 2);
          if (!q || Math.abs(q.z - p.z) > 8) { interior = false; break; }
        }
        if (interior) walls.push({ x, y, z: Math.round(p.z), name: p.name, why });
      }
    }
  }
  return { W, H, floorPx, holes, walls, name: st.name };
}, STEP);
await browser.close();

const cluster = (items, cell = 12) => {
  const m = new Map();
  for (const it of items) { const k = `${Math.floor(it.x / cell)},${Math.floor(it.y / cell)}`; const b = m.get(k) || { n: 0, xs: 0, ys: 0, z: it.z, name: it.name, why: it.why || (it.got === null ? 'no floor under it' : `support z${it.got}`) }; b.n++; b.xs += it.x; b.ys += it.y; m.set(k, b); }
  return [...m.values()].sort((a, b) => b.n - a.n).map((b) => ({ ...b, x: Math.round(b.xs / b.n), y: Math.round(b.ys / b.n) }));
};
console.log(`stage ${stage} "${res.name}" ${res.W}x${res.H}: ${res.floorPx} drawn-floor samples (step ${STEP}); HOLES ${res.holes.length}, interior WALLS ${res.walls.length}`);
console.log(`\nHOLES (floor drawn, marble falls through) — ${cluster(res.holes).length} clusters:`);
for (const b of cluster(res.holes).slice(0, TOP)) console.log(`  ${String(b.n).padStart(4)} px  at (${b.x},${b.y}) drawn z${b.z} ${b.name}: ${b.why}`);
console.log(`\nINTERIOR WALLS (floor drawn all around, marble blocked) — ${cluster(res.walls).length} clusters:`);
for (const b of cluster(res.walls).slice(0, TOP)) console.log(`  ${String(b.n).padStart(4)} px  at (${b.x},${b.y}) z${b.z} ${b.name}: ${b.why}`);
