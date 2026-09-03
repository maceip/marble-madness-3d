import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto('http://127.0.0.1:3000/?stage=1');
await page.waitForFunction(() => window.game && window.game.screen === 'race', null, { timeout: 25000 });

// Center of game canvas
const cx = 480, cy = 300;

// Test 1: Scroll wheel alone (default direction: down/south)
await page.mouse.move(cx, cy);
await page.mouse.wheel(0, 120);
await page.waitForTimeout(200);

const s1 = await page.evaluate(() => {
  const tb = window.game.input.trackball;
  return { wx: +tb.wx.toFixed(2), wy: +tb.wy.toFixed(2) };
});
console.log('Wheel alone (should roll down +wx):', s1);

// Test 2: Left-click held down + drag mouse to the right + scroll wheel
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 60, cy); // drag rightwards (+x)
await page.mouse.wheel(0, 150);     // scroll wheel while holding left click
await page.mouse.up();
await page.waitForTimeout(200);

const s2 = await page.evaluate(() => {
  const tb = window.game.input.trackball;
  return { wx: +tb.wx.toFixed(2), wy: +tb.wy.toFixed(2) };
});
console.log('Wheel + left-click aim right (should have strong +wy):', s2);

// Test 3: Reverse wheel (counter-brake)
await page.mouse.wheel(0, -120);
await page.waitForTimeout(100);

const s3 = await page.evaluate(() => {
  const tb = window.game.input.trackball;
  return { wx: +tb.wx.toFixed(2), wy: +tb.wy.toFixed(2) };
});
console.log('Reverse wheel counter-brake:', s3);

console.log('Page errors:', errors.length ? errors : 'none');
await page.screenshot({ path: 'artifacts/browser/desktop_wheel_aim_test.png' });
console.log('Saved screenshot artifacts/browser/desktop_wheel_aim_test.png');

await browser.close();
