// Full browser harness: actually PLAY a stage to the goal in a real Playwright browser and fail hard on any
// runtime error, any `undefined`, or failure to finish. Not a unit/smoke test — it drives the marble.
//
//   node tools/play_stage.mjs <stage> [--base URL]
//     default base http://127.0.0.1:3200
//
// Guarantees (all must hold or it exits non-zero):
//   1. window.game is the REAL game object, not the <canvas id=game> and not undefined
//      (checks typeof game.go === 'function' && game.stage && game.marble with numeric fields).
//   2. Zero console errors and zero page errors for the whole run.
//   3. The marble spawns grounded and alive (numeric u/v/z, not undefined/NaN).
//   4. Driven downhill (respawns allowed), it REACHES THE GOAL (screen -> timebonus/congrats or goalReached).
import { chromium, devices } from 'playwright-core';

const stage = parseInt(process.argv[2] || '1', 10);
const baseArg = process.argv.indexOf('--base');
const BASE = baseArg >= 0 ? process.argv[baseArg + 1] : 'http://127.0.0.1:3200';
const num = (v) => typeof v === 'number' && Number.isFinite(v);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE.ERROR: ' + m.text().slice(0, 200)); });

let failed = false;
const fail = (m) => { failed = true; console.log('  ✗ ' + m); };
const pass = (m) => console.log('  ✓ ' + m);

try {
  await page.goto(`${BASE}/?stage=${stage}`, { waitUntil: 'load' });

  // 1. REAL game object, never undefined / the canvas element
  const kind = await page.evaluate(() => {
    const g = window.game;
    if (!g) return 'undefined';
    if (typeof g.go !== 'function') return 'not-game(' + (g.tagName || typeof g) + ')';   // e.g. the <canvas>
    if (!g.stage || !g.marble) return 'no-stage-or-marble';
    return 'game';
  }).catch(() => 'timeout');
  if (kind !== 'game') { fail(`window.game is "${kind}", expected the real game object`); }
  else pass('window.game is the real game object');

  if (kind === 'game') {
    await page.waitForFunction(() => window.game.screen === 'race', null, { timeout: 25000 });
    await page.waitForTimeout(1200);

    // marble() must return all-numeric fields (guards against undefined/NaN)
    const readMarble = () => page.evaluate(() => {
      const m = window.game.marble;
      return { u: m.u, v: m.v, z: m.z, grounded: m.grounded, phase: m.phase, deaths: window.game.deaths,
        sy: (m.u + m.v) * 4 - m.z, goal: window.game.goalReached, screen: window.game.screen,
        sup: m.support ? m.support.s.name : null };
    });
    const s0 = await readMarble();
    if (!(num(s0.u) && num(s0.v) && num(s0.z) && num(s0.deaths))) fail('marble fields are not all numeric: ' + JSON.stringify(s0));
    else pass('marble fields numeric');
    if (s0.phase !== 'alive') fail('marble not alive at spawn: ' + s0.phase); else pass('alive at spawn');
    if (!s0.grounded) fail('marble not grounded at spawn (falls through)'); else pass('grounded at spawn on ' + s0.sup);

    // 4. DRIVE to the goal. progressDir>0 = down (u+v grows); <0 = up.
    const dir = await page.evaluate(() => window.game.stage.progressDir);
    const goalSy = await page.evaluate(() => { const z = window.game.stage.zones.find(q => q.kind === 'goal'); if (!z) return null; return ((z.u0 + z.u1) / 2 + (z.v0 + z.v1) / 2) * 4 - (z.zMin || 0); });
    let reached = false, best = dir > 0 ? -1e9 : 1e9, stuckAt = null, stuck = 0;
    for (let i = 0; i < 80 && !reached; i++) {
      const m = await readMarble();
      if (m.screen === 'timebonus' || m.screen === 'congrats' || m.goal) { reached = true; break; }
      if (m.phase !== 'alive') { await page.waitForTimeout(700); continue; }   // respawning
      const prog = dir > 0 ? m.sy : -m.sy;
      if (prog > best + 3) { best = prog; stuck = 0; } else if (++stuck > 6) { stuckAt = m; break; }
      // steer along progress with a little lateral wiggle so it does not jam on a wall
      const lat = ((i % 4 < 2) ? 1 : -1) * 0.4;
      await page.evaluate(([lat, dy]) => window.game.mmDebug ? window.game.mmDebug.spin(lat, dy, 62) : window.game.input.setAI(lat, dy, 380), [lat, dir > 0 ? 1 : -1]);
      await page.waitForTimeout(380);
    }
    const fin = await readMarble();
    console.log('  final:', JSON.stringify(fin), 'goalSy≈' + Math.round(goalSy));
    if (reached) pass(`REACHED THE GOAL (screen ${fin.screen}, deaths ${fin.deaths})`);
    else if (stuckAt) fail(`stuck at sy=${Math.round(stuckAt.sy)} on ${stuckAt.sup} (goal sy≈${Math.round(goalSy)})`);
    else fail(`did not reach the goal in time; furthest sy progress ${Math.round(dir > 0 ? best : -best)} (goal sy≈${Math.round(goalSy)})`);
  }
} catch (e) { fail('exception: ' + e.message); }

if (errors.length) { failed = true; console.log('  ✗ runtime errors:'); errors.slice(0, 10).forEach((e) => console.log('      ' + e)); }
else pass('no console/page errors');

await browser.close();
console.log(failed ? `\nSTAGE ${stage}: FAIL` : `\nSTAGE ${stage}: PASS — played to the goal, no errors`);
process.exit(failed ? 1 : 0);
