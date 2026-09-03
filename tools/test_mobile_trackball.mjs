import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto('http://127.0.0.1:3000/?stage=1');
await page.waitForFunction(() => window.game && window.game.screen === 'race', null, { timeout: 25000 });

const tbBox = await page.locator('#trackball').boundingBox();
console.log('Mobile trackball bounding box:', tbBox);

// Touch drag on mobile trackball
if (tbBox) {
  const cx = tbBox.x + tbBox.width / 2;
  const cy = tbBox.y + tbBox.height / 2;
  await page.touchscreen.tap(cx, cy);
}

await page.screenshot({ path: 'artifacts/browser/trackball_mobile_test.png' });
console.log('Saved screenshot artifacts/browser/trackball_mobile_test.png');
console.log('Page errors:', errors.length ? errors : 'none');

await browser.close();
