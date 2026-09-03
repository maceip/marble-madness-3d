// Production-only review: haptics capabilities + 5-stroke trackball sequence.
// BASE=https://marbles.secure.build node tools/haptic_trackball_review.mjs
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'https://marbles.secure.build';
if (/^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0)(:|\/|$)/i.test(BASE)) {
  console.error('refusing local HTTP; set BASE to https://marbles.secure.build');
  process.exit(2);
}

const snapFn = () => ({
  wx: +window.game.input.trackball.wx.toFixed(3),
  wy: +window.game.input.trackball.wy.toFixed(3),
  speed: +Math.hypot(window.game.input.trackball.wx, window.game.input.trackball.wy).toFixed(3),
  steer: window.game.input.trackball.getSteer(),
});

async function probeCaps(page) {
  return page.evaluate(() => {
    const pads = typeof navigator.getGamepads === 'function' ? [...navigator.getGamepads()].filter(Boolean) : [];
    let vibrateOk = null;
    try { vibrateOk = 'vibrate' in navigator ? navigator.vibrate(0) : false; } catch (e) { vibrateOk = String(e); }
    return {
      ua: navigator.userAgent.slice(0, 120),
      hasVibrate: 'vibrate' in navigator,
      vibrateCall: vibrateOk,
      maxTouch: navigator.maxTouchPoints,
      nativeBridge: !!(window).NativeBridge,
      bridgeCaps: (window).NativeBridge?.caps?.() || null,
      gamepads: pads.map((p) => ({
        id: p.id, buttons: p.buttons.length,
        actuator: !!(p.vibrationActuator),
        effects: p.vibrationActuator?.effects || null,
      })),
      hapticToggle: window.game.input.trackball.enableHaptics,
    };
  });
}

async function installHooks(page) {
  await page.evaluate(() => {
    const tb = window.game.input.trackball;
    window.__hap = { nav: 0, bridge: 0, pats: [] };
    const orig = tb.vibrate.bind(tb);
    tb.vibrate = (pat) => { window.__hap.pats.push(pat); orig(pat); };
    const nv = navigator.vibrate?.bind(navigator);
    if (nv) navigator.vibrate = (p) => { window.__hap.nav++; return nv(p); };
    const nb = window.NativeBridge;
    if (nb) {
      for (const k of ['tick', 'impact', 'thud', 'tbDown', 'tbRoll', 'tbBreakout', 'tbBrake', 'tbUp']) {
        const fn = nb[k];
        if (typeof fn === 'function') nb[k] = function (...a) { window.__hap.bridge++; return fn.apply(this, a); };
      }
    }
  });
}

async function resetBall(page) {
  await page.evaluate(() => {
    const tb = window.game.input.trackball;
    tb.wx = 0; tb.wy = 0; tb.endDrag();
    window.__hap.pats = []; window.__hap.nav = 0; window.__hap.bridge = 0;
  });
}

/** Five discrete finger strokes through the live Trackball API (same as touch dragDelta). */
async function fiveStrokesApi(page, { scale = 1.25, dt = 0.012 } = {}) {
  return page.evaluate(({ scale, dt }) => {
    const tb = window.game.input.trackball;
    const log = [];
    const step = (dx, dy, samples, label) => {
      tb.startDrag();
      const sdx = (dx * scale) / samples, sdy = (dy * scale) / samples;
      for (let i = 0; i < samples; i++) tb.dragDelta(sdx, sdy, dt);
      log.push({ at: label + ':held', ...{
        wx: +tb.wx.toFixed(3), wy: +tb.wy.toFixed(3),
        speed: +Math.hypot(tb.wx, tb.wy).toFixed(3),
        steer: tb.getSteer(),
      }});
      tb.endDrag();
      for (let i = 0; i < 6; i++) tb.update(0.016); // ~100ms coast between lifts
      log.push({ at: label + ':afterLift', ...{
        wx: +tb.wx.toFixed(3), wy: +tb.wy.toFixed(3),
        speed: +Math.hypot(tb.wx, tb.wy).toFixed(3),
        steer: tb.getSteer(),
      }});
    };
    // upward twice (~80px each), then down-left three times
    step(0, -80, 8, 'up1');
    step(0, -80, 8, 'up2');
    step(-60, 80, 8, 'dl1');
    step(-60, 80, 8, 'dl2');
    step(-60, 80, 8, 'dl3');
    return { log, hap: window.__hap };
  }, { scale, dt });
}

async function fiveStrokesPointer(page, kind, box) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const strokes = [
    { dx: 0, dy: -70, name: 'up1' },
    { dx: 0, dy: -70, name: 'up2' },
    { dx: -50, dy: 70, name: 'dl1' },
    { dx: -50, dy: 70, name: 'dl2' },
    { dx: -50, dy: 70, name: 'dl3' },
  ];
  const log = [];
  for (const s of strokes) {
    if (kind === 'touch') {
      await page.touchscreen.tap(cx, cy).catch(() => {});
    }
    if (kind === 'touch') {
      // Playwright has no multi-move touch drag helper on all versions; use mouse on trackball
      // after dispatching via CDP-like pointer through page.mouse on the widget.
    }
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + s.dx, cy + s.dy, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(80);
    const st = await page.evaluate(snapFn);
    log.push({ at: s.name, ...st });
  }
  const hap = await page.evaluate(() => window.__hap);
  return { log, hap };
}

async function bootRace(page) {
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.game && typeof window.game.go === 'function', null, { timeout: 20000 });
  await page.evaluate(() => {
    window.game.sound.init();
    window.game.playerName = 'ACE';
    window.game.mode = '1p';
    window.game.newGame(0);
    window.game.go('race');
  });
  await page.waitForFunction(() => window.game.screen === 'race', null, { timeout: 8000 });
}

const out = {};
const browser = await chromium.launch({ channel: 'chrome', headless: true });

{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await bootRace(page);
  out.desktopCaps = await probeCaps(page);
  await installHooks(page);
  await resetBall(page);
  out.desktopApi = await fiveStrokesApi(page, { scale: 1.5 }); // dedicated trackball widget scale
  await resetBall(page);
  const tbBox = await page.locator('#trackball').boundingBox();
  out.desktopTrackballMouse = tbBox ? await fiveStrokesPointer(page, 'mouse', tbBox) : { error: 'no #trackball' };
  await resetBall(page);
  const gameBox = await page.locator('#game').boundingBox();
  out.desktopGameCanvasMouse = gameBox ? await fiveStrokesPointer(page, 'mouse', gameBox) : { error: 'no #game' };
  out.desktopGameAfter = await page.evaluate(() => ({
    aim: window.game.input.aimVector || null,
    leftPathNote: 'left-button drag on #game updates aimVector, not dragDelta',
  }));
  await page.close();
}

{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
  });
  const page = await ctx.newPage();
  await bootRace(page);
  out.androidChromeCaps = await probeCaps(page);
  await installHooks(page);
  await resetBall(page);
  out.androidChromeApi = await fiveStrokesApi(page, { scale: 1.25 }); // game-canvas touch scale
  await page.close();
  await ctx.close();
}

// Do not spoof an iPhone UA in Chromium and call that an iOS haptics test. It still runs Chromium's APIs.
// Real iOS Safari/device capability must be reported from a real WebKit/iPhone session.
out.iosSafariCaps = { tested: false, reason: 'requires a connected physical iPhone running Safari' };

await browser.close();
console.log(JSON.stringify(out, null, 2));
