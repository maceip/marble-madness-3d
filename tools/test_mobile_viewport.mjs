// Phone-layout regression test: the arcade view must stay 288x240 and scroll with the marble, and the on-screen
// trackball must respond to touch. Runs in a portrait mobile viewport (the desktop tests never exercised this).
import { chromium, devices } from 'playwright-core';
const base = process.env.BASE || 'http://127.0.0.1:3000';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failed++; };

await page.goto(`${base}/?stage=1`);
await page.waitForFunction(() => window.game && window.game.screen === 'race', null, { timeout: 30000 });
await page.waitForTimeout(500);

const v = await page.evaluate(() => ({ viewW: window.game.r.viewW, viewH: window.game.r.viewH, stageH: window.game.stage.height, camY: window.game.r.cam.y, scale: window.game.r.scale, offY: window.game.r.offY, cw: window.game.r.canvas.width, ch: window.game.r.canvas.height }));
check('view is the 288x240 arcade window', v.viewW === 288 && v.viewH === 240, `${v.viewW}x${v.viewH}`);
check('view is smaller than the stage so it must scroll', v.viewH < v.stageH, `stage ${v.stageH} rows`);
check('presented with uniform scale and letterbox', v.scale > 0 && Math.abs(v.scale - v.cw / v.viewW) < 0.01 && v.offY > 0, `scale ${v.scale.toFixed(2)} offY ${v.offY}`);

// move the marble well down the stage (teleport, independent of the steering path): the camera must follow
await page.evaluate(() => { const g = window.game; const p = g.pickAtPixel(150, 330)[0] || g.pickAtPixel(144, 300)[0]; if (p) g.marble.place(p.u, p.v, p.z); });
await page.waitForTimeout(1500);
const after = await page.evaluate(() => ({ camY: window.game.r.cam.y, my: (window.game.marble.u + window.game.marble.v) * 4 - window.game.marble.z, stageH: window.game.stage.height, viewH: window.game.r.viewH }));
check('camera scrolled down with the marble', after.camY > v.camY + 20, `cam.y ${v.camY.toFixed(0)} -> ${after.camY.toFixed(0)}`);
check('camera clamped to the stage', after.camY <= after.stageH - after.viewH + 0.5, `${after.camY.toFixed(0)} <= ${after.stageH - after.viewH}`);
check('marble is inside the view', after.my >= after.camY - 8 && after.my <= after.camY + after.viewH + 8, `marble row ${after.my.toFixed(0)}`);

// the on-screen trackball must be visible and react to a touch drag
const tb = await page.$('#trackball');
check('trackball canvas present', !!tb);
if (tb) {
  const box = await tb.boundingBox();
  check('trackball visible on screen', !!box && box.width > 40 && box.y + box.height <= 915, box ? `at y ${box.y.toFixed(0)} h ${box.height.toFixed(0)}` : 'no box');
  const before = await page.evaluate(() => Math.hypot(window.game.input.trackball.wx, window.game.input.trackball.wy));
  await page.evaluate(() => {
    const el = document.getElementById('trackball'); const r = el.getBoundingClientRect();
    const mk = (type, x, y) => { const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y, pageX: x, pageY: y }); el.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true })); };
    let x = r.left + r.width * 0.3, y = r.top + r.height * 0.5;
    mk('touchstart', x, y);
    for (let i = 0; i < 12; i++) { x += r.width * 0.04; mk('touchmove', x, y); }
    mk('touchend', x, y);
  });
  await page.waitForTimeout(100);
  const during = await page.evaluate(() => Math.hypot(window.game.input.trackball.wx, window.game.input.trackball.wy));
  check('touch drag spins the trackball', during > before + 0.05, `omega ${before.toFixed(2)} -> ${during.toFixed(2)}`);
}
await page.screenshot({ path: 'artifacts/browser/mobile_viewport.png' });
await browser.close();
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log('mobile viewport OK');
