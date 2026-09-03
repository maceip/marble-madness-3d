// Browser smoke test / screenshot harness.
//   node tools/test_game.mjs [--stage N] [--url http://127.0.0.1:3000] [--drive]
// Requires the dev server (npm run serve). Uses the locally installed Chrome via playwright-core.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const stage = opt('--stage', '1');
const base = opt('--url', 'http://127.0.0.1:3000');
const drive = args.includes('--drive');
const path = opt('--path', '');   // e.g. "ArrowDown:1500,ArrowRight:400"
const shots = args.includes('--shots');
const outDir = 'artifacts/browser';
mkdirSync(outDir, { recursive: true });

async function launch() {
  for (const channel of ['chrome', 'chromium', undefined]) {
    try { return await chromium.launch({ channel, headless: true }); } catch (e) { /* try next */ }
  }
  throw new Error('no chromium available');
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 900, height: 760 } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.type(), m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${base}/?stage=${stage}`);
await page.waitForFunction(() => window.game && window.game.screen !== 'boot', null, { timeout: 15000 });
await page.waitForTimeout(400);
await page.screenshot({ path: `${outDir}/s${stage}_intro.png` });
// wait for the race
await page.waitForFunction(() => window.game.screen === 'race', null, { timeout: 20000 });
await page.screenshot({ path: `${outDir}/s${stage}_race0.png` });

const snap = () => page.evaluate(() => {
  const g = window.game; const m = g.marble;
  return { scr: g.screen, u: +m.u.toFixed(1), v: +m.v.toFixed(1), z: +m.z.toFixed(0), mx: Math.round((m.u - m.v) * 8), my: Math.round((m.u + m.v) * 4 - m.z), sp: +m.speed.toFixed(1), gnd: m.grounded, ph: m.phase, dz: +m.dizzyT.toFixed(1), score: g.score, time: +g.timeLeft.toFixed(1), deaths: g.deaths, sup: m.support ? m.support.s.name : null, blk: m.lastBlock };
});
const startAt = opt('--start', '');
if (startAt) {
  const [mx, my, z] = startAt.split(',').map(Number);
  await page.evaluate(([mx, my, z]) => { const g = window.game; const S = (my + z) / 4, D = mx / 8; g.marble.place((S + D) / 2, (S - D) / 2, z); g.centerCameraOnMarble(true); }, [mx, my, z]);
  await page.waitForTimeout(200);
}
console.log('start', JSON.stringify(await snap()));

if (path) {
  let k = 0;
  for (const seg of path.split(',')) {
    const parts = seg.split(':');
    const key = parts[0]; const ms = +parts[parts.length - 1];
    const keys = (key === 'wait' || key === 'ai') ? [] : key.split('+');
    if (key === 'ai') { const [ax, ay] = parts[1].split('/').map(Number); await page.evaluate(([ax, ay, ms]) => window.game.input.setAI(ax, ay, ms), [ax, ay, ms]); }
    for (const kk of keys) await page.keyboard.down(kk);
    if (args.includes('--trace')) {
      for (let t = 0; t < ms; t += 100) { await page.waitForTimeout(100); const s = await snap(); console.log(`   ${key} +${t + 100}ms`, `mx=${s.mx} my=${s.my} z=${s.z} u=${s.u} v=${s.v} sup=${s.sup} gnd=${s.gnd} sp=${s.sp}`); if (s.ph !== 'alive') break; }
    } else await page.waitForTimeout(ms);
    for (const kk of keys) await page.keyboard.up(kk);
    const s = await snap();
    console.log(`p${k} ${seg}`, JSON.stringify(s));
    if (shots) await page.screenshot({ path: `${outDir}/s${stage}_p${k}.png` });
    k++;
    if (s.scr !== 'race') break;
  }
}

if (drive) {
  // roll down-screen (ArrowDown) in bursts, logging state
  for (let i = 0; i < 12; i++) {
    await page.keyboard.down('ArrowDown');
    await page.waitForTimeout(700);
    await page.keyboard.up('ArrowDown');
    await page.waitForTimeout(300);
    const s = await snap();
    console.log(`t${i}`, JSON.stringify(s));
    if (i % 3 === 2) await page.screenshot({ path: `${outDir}/s${stage}_drive${i}.png` });
    if (s.scr !== 'race') break;
  }
}
await browser.close();
