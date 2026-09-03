import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:3000/?stage=2');
await page.waitForFunction(() => window.game && window.game.screen === 'race', null, { timeout: 25000 });
const out = await page.evaluate(() => {
  const g = window.game; const res = [];
  for (const [x, y, z] of [[171, 243, 69], [170, 246, 67], [168, 250, 65], [165, 256, 62], [160, 266, 57], [150, 285, 47]]) res.push([x, y, z, g.probe(x, y, z)]);
  return res;
});
for (const r of out) console.log(JSON.stringify(r));
await browser.close();
