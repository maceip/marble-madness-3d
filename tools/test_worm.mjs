import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto('http://127.0.0.1:3000/');
await page.waitForFunction(() => window.game && window.game.screen === 'title', null, { timeout: 15000 });

// Start Stage 2 (Beginner race) directly
await page.evaluate(() => {
  window.game.newGame(1);
});
await page.waitForFunction(() => window.game.screen === 'race', null, { timeout: 10000 });
console.log('Stage 2 race active. Waiting for worm animation frames...');

// Let worm hop around for 2 seconds
await page.waitForTimeout(2000);
await page.screenshot({ path: 'artifacts/browser/stage2_worm.png' });
console.log('Saved artifacts/browser/stage2_worm.png');

console.log('Page errors:', errors.length ? errors : 'none');
await browser.close();
