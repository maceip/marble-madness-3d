import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();

await page.setContent(`
  <div id="box" style="width: 300px; height: 300px; background: red;"></div>
  <script>
    window.log = [];
    const b = document.getElementById('box');
    let down = false;
    let aim = { dx: 0, dy: 1 };
    b.addEventListener('mousedown', (e) => { down = true; window.log.push('down'); });
    window.addEventListener('mouseup', () => { down = false; window.log.push('up'); });
    b.addEventListener('mousemove', (e) => {
      if (down) {
        aim = { dx: e.movementX, dy: e.movementY };
        window.log.push('move:' + aim.dx + ',' + aim.dy);
      }
    });
    b.addEventListener('wheel', (e) => {
      e.preventDefault();
      window.log.push('wheel:down=' + down + ':deltaY=' + e.deltaY + ':aim=' + aim.dx + ',' + aim.dy);
    }, { passive: false });
  </script>
`);

const box = await page.locator('#box').boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;

// Mouse down + move + wheel
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 20, cy + 30);
await page.mouse.wheel(0, 100);
await page.mouse.up();

const logs = await page.evaluate(() => window.log);
console.log('Browser wheel+drag logs:', logs);

await browser.close();
