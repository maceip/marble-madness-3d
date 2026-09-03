import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://127.0.0.1:3000/?stage=1');
await page.waitForFunction(() => window.game && window.game.screen === 'race', null, { timeout: 20000 });
const out = await page.evaluate(() => {
  const g = window.game; const res = [];
  for (const [x, y, z] of [[148, 97, 132], [160, 97, 132], [175, 97, 131], [190, 97, 131], [210, 97, 131], [230, 110, 130], [148, 62, 135], [145, 250, 100], [150, 340, 100], [236, 395, 70]]) res.push([x, y, z, g.probe(x, y, z)]);
  const hm = g.stage.heightmap; const hist = {}; for (let i = 0; i < hm.labels.length; i += 7) { hist[hm.labels[i]] = (hist[hm.labels[i]] || 0) + 1; }
  return { res, hist, comps: g.stage.heightmap.comps.map((c) => `${c.id}:${c.kind}:${c.a.toFixed(0)}`).join(' ') };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
