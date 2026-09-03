import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 760 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto('http://127.0.0.1:3000/?stage=1');
await page.waitForFunction(() => window.game && window.game.screen === 'race', null, { timeout: 25000 });

// Verify trackball canvas exists
const tbBox = await page.locator('#trackball').boundingBox();
console.log('Trackball bounding box:', tbBox);

// Sample initial marble position and trackball angular speed
const s0 = await page.evaluate(() => {
  const g = window.game;
  return {
    mx: g.marble.u,
    my: g.marble.v,
    wx: g.input.trackball.wx,
    wy: g.input.trackball.wy,
  };
});
console.log('Initial state:', s0);

// Drag on trackball from center downwards to roll down screen
if (tbBox) {
  const cx = tbBox.x + tbBox.width / 2;
  const cy = tbBox.y + tbBox.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy + 40, { steps: 5 });
  await page.mouse.up();
}

await page.waitForTimeout(300);

const s1 = await page.evaluate(() => {
  const g = window.game;
  return {
    mx: +g.marble.u.toFixed(2),
    my: +g.marble.v.toFixed(2),
    wx: +g.input.trackball.wx.toFixed(2),
    wy: +g.input.trackball.wy.toFixed(2),
    rot: [...g.input.trackball.rot.slice(0, 4)],
  };
});
console.log('After touch drag state:', s1);

// Test WebMCP spin_trackball tool
const mcpRes = await page.evaluate(async () => {
  return await window.webmcp.callTool('spin_trackball', { dx: 0, dy: 1, speed: 70 });
});
console.log('WebMCP spin_trackball response:', mcpRes);

await page.waitForTimeout(400);

const s2 = await page.evaluate(() => {
  const g = window.game;
  return {
    mx: +g.marble.u.toFixed(2),
    my: +g.marble.v.toFixed(2),
    speed: +g.marble.speed.toFixed(2),
  };
});
console.log('After WebMCP spin state:', s2);

console.log('Page errors:', errors.length ? errors : 'none');

// Screenshot to see the 3D trackball rendered
await page.screenshot({ path: 'artifacts/browser/trackball_3d_test.png' });
console.log('Saved screenshot artifacts/browser/trackball_3d_test.png');

await browser.close();
