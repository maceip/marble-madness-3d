// Smoke: every stage, hold the course direction for a few seconds via AI steering; report state + page errors.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 760 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
for (const st of [1, 2, 3, 4, 5, 6]) {
  await page.goto(`http://127.0.0.1:3000/?stage=${st}`);
  await page.waitForFunction(() => window.game && window.game.screen === 'race', null, { timeout: 25000 });
  const dir = st === 5 ? [0, -1] : [0, 1];
  for (let i = 0; i < 8; i++) {
    await page.evaluate(([ax, ay]) => window.game.input.setAI(ax, ay, 900), dir);
    await page.waitForTimeout(1000);
  }
  const s = await page.evaluate(() => { const g = window.game; const m = g.marble; return { screen: g.screen, stage: g.stage.name, score: g.score, deaths: g.deaths, time: +g.timeLeft.toFixed(1), phase: m.phase, hz: g.hazards.length, popups: g.popups.length }; });
  console.log(st, JSON.stringify(s));
}
console.log('page errors:', errors.length ? errors : 'none');
await browser.close();
