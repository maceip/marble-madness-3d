// Route sanity check: teleport the marble to map points and verify it is supported and stays put.
//   node tools/route_check.mjs --stage 1 --points "148,63,133;204,225,108;..."   (mx,my,z triples)
// Reports the support surface found at each point and where the marble ends after 0.6 s of free physics.
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const stage = opt('--stage', '1');
const base = opt('--url', 'http://127.0.0.1:3000');
const pts = opt('--points', '').split(';').filter(Boolean).map((p) => p.split(',').map(Number));

async function launch() {
  for (const channel of ['chrome', 'chromium', undefined]) {
    try { return await chromium.launch({ channel, headless: true }); } catch { /* next */ }
  }
  throw new Error('no chromium');
}
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 900, height: 760 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${base}/?stage=${stage}`);
await page.waitForFunction(() => window.game && window.game.screen === 'race', null, { timeout: 25000 });
await page.evaluate(() => { window.game.paused = true; });

for (const [mx, my, z] of pts) {
  const r = await page.evaluate(([mx, my, z]) => {
    const g = window.game; const m = g.marble;
    const S = (my + z) / 4, D = mx / 8; const u = (S + D) / 2, v = (S - D) / 2;
    const before = g.probe(mx, my, z);
    m.place(u, v, z);
    // settle: find actual support at this spot first
    const sup0 = before.sup;
    const ev = [];
    for (let i = 0; i < 36; i++) m.step(g.stage, { ax: 0, ay: 0 }, 1 / 60, ev);
    const mx2 = Math.round((m.u - m.v) * 8), my2 = Math.round((m.u + m.v) * 4 - m.z);
    return { sup0, hb: before.hb, cands: before.cands, after: { mx: mx2, my: my2, z: +m.z.toFixed(1), gnd: m.grounded, phase: m.phase, sup: m.support ? m.support.s.name : null }, died: ev.some((e) => e.type === 'die') };
  }, [mx, my, z]);
  const ok = r.after.gnd && r.after.phase === 'alive' && Math.abs(r.after.z - z) < 10;
  console.log(`${ok ? 'OK  ' : 'FAIL'} (${mx},${my},z${z}) support=${r.sup0} cands=[${r.cands.join(' ')}] -> after: (${r.after.mx},${r.after.my}) z=${r.after.z} gnd=${r.after.gnd} sup=${r.after.sup}${r.died ? ' DIED' : ''}`);
}
await browser.close();
