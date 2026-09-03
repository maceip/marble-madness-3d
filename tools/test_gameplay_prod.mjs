// End-to-end gameplay harness against PRODUCTION (https://marbles.secure.build), browser only.
// Verifies the things a player feels: the marble falls off edges, rails/barriers block it, and a steering
// direction moves it the intended way. Uses the REAL game object (never the <canvas id=game> element:
// canvas.screen is undefined, so a `screen !== 'boot'` wait is satisfied by the canvas — wait for game.go).
import { chromium, devices } from 'playwright-core';
const BASE = process.env.BASE || 'https://marbles.secure.build';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, bypassCSP: false });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
let failed = 0; const check = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  ' + d : ''}`); if (!ok) failed++; };
const realGame = () => page.waitForFunction(() => window.game && typeof window.game.go === 'function' && window.game.stage, null, { timeout: 30000 });

await page.goto(`${BASE}/?stage=1`, { waitUntil: 'load' });
await realGame();
await page.waitForFunction(() => window.game.screen === 'race', null, { timeout: 30000 });
await page.waitForTimeout(500);

// collision actually loaded from prod
const hm = await page.evaluate(() => ({ has: !!window.game.stage.heightmap, comps: window.game.stage.heightmap ? window.game.stage.heightmap.comps.length : 0, surfaces: window.game.stage.surfaces.length }));
check('heightmap + surfaces loaded from prod', hm.has && hm.comps > 0 && hm.surfaces > 0, JSON.stringify(hm));

const snap = () => page.evaluate(() => { const m = window.game.marble; return { u: +m.u.toFixed(2), v: +m.v.toFixed(2), z: +m.z.toFixed(1), phase: m.phase, grounded: m.grounded, sup: m.support ? m.support.s.name : null, deaths: window.game.deaths }; });
const start = await snap();
console.log('start:', JSON.stringify(start));
check('marble starts grounded on a surface', start.grounded && !!start.sup);

// 1. falling: place the marble just off the map edge and let physics run; it must leave the ground and die/respawn
const fell = await page.evaluate(async () => {
  const g = window.game, m = g.marble; const d0 = g.deaths;
  // walk far outside every surface footprint
  m.place(m.u - 30, m.v - 30, m.z);
  const t0 = performance.now(); let sawAir = false, minZ = m.z;
  while (performance.now() - t0 < 2500) { await new Promise((r) => setTimeout(r, 50)); if (!m.grounded) sawAir = true; minZ = Math.min(minZ, m.z); if (g.deaths > d0) break; }
  return { sawAir, died: g.deaths > d0, phase: m.phase, dz: +(m.z - minZ).toFixed(0) };
});
check('marble falls off the map edge (leaves ground and dies)', fell.sawAir && fell.died, JSON.stringify(fell));

// respawn and settle
await page.evaluate(() => window.game.marble.place(window.game.stage.start.u, window.game.stage.start.v, window.game.stage.start.z ?? 0));
await page.waitForTimeout(400);

// 2. steering direction: push "down the screen" (ay>0) and the marble's screen-y must increase (it rolls down)
const steer = await page.evaluate(async () => {
  const g = window.game, m = g.marble;
  const sy = () => (m.u + m.v) * 4 - m.z, sx = () => (m.u - m.v) * 8;
  const y0 = sy(), x0 = sx();
  g.input.setAI(0, 1, 1500);            // ay = +1 => down the screen
  await new Promise((r) => setTimeout(r, 1600));
  return { dScreenY: +(sy() - y0).toFixed(0), dScreenX: +(sx() - x0).toFixed(0), grounded: m.grounded };
});
check('steering down-screen rolls the marble down-screen', steer.dScreenY > 8 && Math.abs(steer.dScreenX) < Math.abs(steer.dScreenY), JSON.stringify(steer));

// 3. a wall/rail must block: find a manual wall surface, sit next to it, push into it, expect little penetration
const wall = await page.evaluate(async () => {
  const g = window.game, m = g.marble;
  const w = g.stage.surfaces.find((s) => s.kind === 'wall');
  if (!w) return { noWall: true };
  const cu = (w.u0 + w.u1) / 2, cv = (w.v0 + w.v1) / 2;
  // stand just outside the wall on the low side and shove toward it for 1.2 s
  m.place(cu - 2.2, cv - 2.2, (w.z0 ?? 0));
  await new Promise((r) => setTimeout(r, 150));
  const before = Math.hypot(m.u - cu, m.v - cv);
  g.input.setAI(0.7, 0.7, 1200);
  await new Promise((r) => setTimeout(r, 1300));
  const after = Math.hypot(m.u - cu, m.v - cv);
  return { name: w.name, before: +before.toFixed(2), after: +after.toFixed(2), closed: +(before - after).toFixed(2) };
});
if (wall.noWall) check('a wall surface exists to test', false); else check('wall blocks the marble (does not pass through)', wall.after > 0.8, JSON.stringify(wall));

// 4. trackball touch drives steering
const tb = await page.evaluate(async () => {
  const el = document.getElementById('trackball'); if (!el) return { noTb: true };
  const r = el.getBoundingClientRect();
  const t = window.game.input.trackball; const before = Math.hypot(t.wx, t.wy);
  const mk = (type, x, y) => { const tt = new Touch({ identifier: 1, target: el, clientX: x, clientY: y }); el.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [tt], changedTouches: [tt], bubbles: true, cancelable: true })); };
  let x = r.left + r.width * 0.3, y = r.top + r.height * 0.5; mk('touchstart', x, y);
  for (let i = 0; i < 14; i++) { x += r.width * 0.03; mk('touchmove', x, y); }
  mk('touchend', x, y);
  await new Promise((res) => setTimeout(res, 120));
  return { before: +before.toFixed(2), after: +Math.hypot(t.wx, t.wy).toFixed(2) };
});
if (tb.noTb) check('trackball element present', false); else check('touch-drag spins the trackball', tb.after > tb.before + 0.05, JSON.stringify(tb));

await page.screenshot({ path: 'artifacts/browser/gameplay_prod.png' });
await browser.close();
if (failed) { console.log(`\n${failed} check(s) FAILED`); process.exit(1); }
console.log('\ngameplay OK on ' + BASE);
