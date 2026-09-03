// Unfolded foldable (Pixel Fold / Pixel 9 Pro Fold inner): menus must be full-bleed (no desktop
// column gutters) and the 288×240 race view must contain-fit (zoomed to the limiting axis).
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:3200';
mkdirSync('artifacts/browser', { recursive: true });

const SIZES = [
  { id: 'fold-open', w: 790, h: 844, label: 'Pixel 9 Pro Fold unfolded' },
  { id: 'fold-land', w: 883, h: 736, label: 'Pixel Fold unfolded landscape' },
];
const MENUS = ['title', 'menu', 'name', 'control', 'connect', 'gameover', 'congrats', 'rematch'];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
let fails = 0;
const check = (n, ok, d = '') => { console.log(`  ${ok ? '✓' : '✗'} ${n}${d ? '  ' + d : ''}`); if (!ok) fails++; };

for (const size of SIZES) {
  console.log(`\n${size.label}  ${size.w}×${size.h}`);
  const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE + '/?stage=1', { waitUntil: 'load' });
  await page.waitForFunction(() => window.game && window.game.stage && typeof window.game.go === 'function', null, { timeout: 20000 });

  const ff = await page.evaluate(() => {
    const cw = window.game.r.canvas.width, ch = window.game.r.canvas.height;
    const short = Math.min(cw, ch), long = Math.max(cw, ch), aspect = cw / ch;
    return { cw, ch, short, long, aspect, fold: short >= 680 && long <= 1100 && aspect >= 0.72 && aspect <= 1.40 };
  });
  check('detected as fold', ff.fold, JSON.stringify(ff));

  for (const screen of MENUS) {
    await page.evaluate((s) => {
      const g = window.game;
      if (s === 'congrats') { g.finalTally = { total: 128400, drained: 0 }; g.score = 60000; }
      g.go(s);
    }, screen);
    await page.waitForTimeout(200);
    const geo = await page.evaluate((screen) => {
      const g = window.game;
      const cw = g.r.canvas.width;
      const t = g.screens.debugTargets();
      const named = t.column || t.card0 || t.optA || t.copy || t.playAgain || t.start;
      const boxes = Object.values(t).filter((b) => b.w < cw * 0.995 || named === b);
      const widest = named || boxes.reduce((a, b) => (b.w > a.w ? b : a), boxes[0] || { w: 0, x: cw / 2 });
      const left = widest.x - widest.w / 2;
      const right = cw - (widest.x + widest.w / 2);
      return { screen: g.screen, cw, widest: widest.w, left, right, frac: widest.w / cw };
    }, screen);
    check(`${screen} full-bleed (≥92% width)`, geo.frac >= 0.92, `w=${geo.widest}/${geo.cw} gutters L${geo.left.toFixed(0)} R${geo.right.toFixed(0)}`);
    check(`${screen} no side gutter (>40px)`, geo.left <= 40 && geo.right <= 40, `L${geo.left.toFixed(0)} R${geo.right.toFixed(0)}`);
    await page.screenshot({ path: `artifacts/browser/fold_${size.id}_${screen}.png` });
  }

  await page.evaluate(() => { window.game.sound.init?.(); window.game.newGame(0); });
  await page.waitForFunction(() => window.game.screen === 'race' || window.game.screen === 'intro', null, { timeout: 20000 });
  await page.waitForTimeout(400);
  const race = await page.evaluate(() => {
    const r = window.game.r;
    const expect = Math.min(r.canvas.width / r.viewW, r.canvas.height / r.viewH);
    const dw = Math.round(r.viewW * r.scale), dh = Math.round(r.viewH * r.scale);
    return {
      screen: window.game.screen, cw: r.canvas.width, ch: r.canvas.height,
      viewW: r.viewW, viewH: r.viewH, scale: r.scale, expect,
      dw, dh, offX: r.offX, offY: r.offY,
      fillsWidth: Math.abs(dw - r.canvas.width) <= 2 || r.scale === r.canvas.height / r.viewH,
      fillsLimit: Math.abs(r.scale - expect) < 0.02,
    };
  });
  check('race still 288×240 arcade view', race.viewW === 288 && race.viewH === 240, `${race.viewW}x${race.viewH}`);
  check('race scale is contain-fit (max zoom)', race.fillsLimit, `scale ${race.scale.toFixed(3)} expect ${race.expect.toFixed(3)}`);
  check('race blit fills the limiting axis', race.fillsWidth, `blit ${race.dw}x${race.dh} in ${race.cw}x${race.ch} off ${race.offX},${race.offY}`);
  if (race.ch - race.dh > 24) {
    check('portrait-fold race sits high (trackball band below)', race.offY <= 40, `offY ${race.offY} extra ${race.ch - race.dh}`);
  }
  await page.screenshot({ path: `artifacts/browser/fold_${size.id}_race.png` });
  check('no page errors', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

await browser.close();
console.log(fails ? `\nFOLD: FAIL (${fails})` : '\nFOLD: PASS');
process.exit(fails ? 1 : 0);
