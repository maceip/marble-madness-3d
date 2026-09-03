import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:3000/?stage=2');
await page.waitForFunction(() => window.game && window.game.screen === 'race', null, { timeout: 25000 });
const out = await page.evaluate(() => { const g = window.game; return [[156,243,66],[150,252,61],[140,270,52],[120,300,38]].map(([x,y,z]) => [x,y,z,g.probe(x,y,z)]); });
for (const r of out) console.log(JSON.stringify(r));
await browser.close();
