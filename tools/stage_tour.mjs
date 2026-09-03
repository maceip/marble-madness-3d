// Screenshot the intro and a few seconds of play for every stage.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
mkdirSync('artifacts/browser', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 760 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
for (const st of [1, 2, 3, 4, 5, 6]) {
  await page.goto(`http://127.0.0.1:3000/?stage=${st}`);
  await page.waitForFunction(() => window.game && window.game.screen !== 'boot', null, { timeout: 20000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `artifacts/browser/tour_s${st}_intro.png` });
  await page.waitForFunction(() => window.game.screen === 'race', null, { timeout: 20000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `artifacts/browser/tour_s${st}_race.png` });
  const s = await page.evaluate(() => { const g = window.game; const m = g.marble; return { stage: g.stage.name, hz: g.hazards.length, u: +m.u.toFixed(1), v: +m.v.toFixed(1), z: +m.z.toFixed(0), phase: m.phase, deaths: g.deaths, time: +g.timeLeft.toFixed(1) }; });
  console.log(st, JSON.stringify(s));
}
await browser.close();
