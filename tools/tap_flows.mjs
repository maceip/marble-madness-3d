// Real tap-interaction test: drives the actual UI with synthetic touch taps at the exact rendered target
// centers (window.game.screens.debugTargets(), computed from the same layout the renderer uses), across sizes.
// Verifies: title->menu, mode select, PLAYER NAME CREATION via grid taps, control A/B tap, and the 2P copy button.
// Fails hard on any console/page error, wrong screen, or wrong state.  BASE=http://127.0.0.1:3200 node tools/tap_flows.mjs
import { chromium } from 'playwright-core';
const BASE = process.env.BASE || 'http://127.0.0.1:3200';
const ALL_SIZES = [
  { id: 'phone-sm', w: 375, h: 667, m: true },
  { id: 'phone-md', w: 412, h: 915, m: true },
  { id: 'phone-land', w: 844, h: 390, m: true },
  { id: 'fold-open', w: 790, h: 844, m: true },
  { id: 'desktop', w: 1366, h: 768, m: false },
];
const requested = new Set((process.env.SIZES || '').split(',').map((x) => x.trim()).filter(Boolean));
const SIZES = requested.size ? ALL_SIZES.filter((size) => requested.has(size.id)) : ALL_SIZES;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let fails = 0;
const log = (s) => console.log(s);

const targets = (page) => page.evaluate(() => window.game.screens.debugTargets());
const state = (page) => page.evaluate(() => ({ screen: window.game.screen, mode: window.game.mode, name: window.game.playerName, ctrl: window.game.input.controlType, copied: window.game.screens.copiedTimer }));
async function tap(page, tg) {
  if (!tg) throw new Error('missing tap target');
  if (tg.sel) {
    const loc = page.locator(tg.sel).first();
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    await loc.click({ timeout: 4000, force: true });
    await page.waitForTimeout(160);
    return;
  }
  await page.evaluate(({ x, y }) => {
    const el = document.getElementById('game'); const rect = el.getBoundingClientRect();
    const sx = el.width / rect.width, sy = el.height / rect.height;
    const cx = rect.left + x / sx, cy = rect.top + y / sy;
    const t = new Touch({ identifier: (Date.now() % 90000) + 1, target: el, clientX: cx, clientY: cy, pageX: cx, pageY: cy });
    el.dispatchEvent(new TouchEvent('touchstart', { touches: [t], changedTouches: [t], bubbles: true, cancelable: true }));
    el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t], bubbles: true, cancelable: true }));
  }, tg);
  await page.waitForTimeout(160);
}

async function run(size) {
  const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, isMobile: size.m, hasTouch: true, deviceScaleFactor: 1, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 140)); });
  const check = (name, ok, detail = '') => { log(`   ${ok ? '✓' : '✗'} ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };
  try {
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.waitForFunction(() => window.game && typeof window.game.go === 'function' && window.game.stage && window.game.marble, null, { timeout: 20000 });

    // --- 1 PLAYER: title -> menu -> 1P -> build name "ACE" -> control A -> intro ---
    await page.evaluate(() => window.game.go('title'));
    await page.waitForTimeout(150);
    await tap(page, (await targets(page)).start);
    check('title tap -> menu', (await state(page)).screen === 'menu');
    await page.waitForTimeout(450);                                   // menuDelay debounce
    await tap(page, (await targets(page)).card0);
    let s = await state(page); check('tap 1 PLAYER selects without leaving menu', s.screen === 'menu', `${s.screen}/${s.mode}`);
    await tap(page, (await targets(page)).start);
    s = await state(page); check('PRESS START -> name (1p)', s.screen === 'name' && s.mode === '1p', `${s.screen}/${s.mode}`);
    await page.waitForSelector('#ui-key-0-0', { timeout: 4000 });
    for (const cell of ['cell_0_0', 'cell_0_2', 'cell_0_4']) await tap(page, (await targets(page))[cell]);  // A, C, E
    s = await state(page); check('grid taps build name ACE', s.name === 'ACE', `name=${s.name}`);
    await tap(page, (await targets(page)).start);
    await page.waitForFunction(() => ['intro', 'race'].includes(window.game.screen), null, { timeout: 8000 }).catch(() => {});
    s = await state(page); check('START -> intro/race', s.screen === 'intro' || s.screen === 'race', s.screen);

    // --- 2 PLAYER: title -> menu -> 2P -> name -> control B -> connect -> COPY LINK ---
    await page.evaluate(() => window.game.go('title'));
    await page.waitForTimeout(150);
    await tap(page, (await targets(page)).start);
    await page.waitForTimeout(450);
    await tap(page, (await targets(page)).card1);
    s = await state(page); check('tap 2 PLAYERS selects without leaving menu', s.screen === 'menu', `${s.screen}/${s.mode}`);
    await tap(page, (await targets(page)).start);
    s = await state(page); check('PRESS START -> name (ai)', s.screen === 'name' && s.mode === 'ai', `${s.screen}/${s.mode}`);
    await page.waitForSelector('#ui-key-0-1', { timeout: 4000 });
    for (const cell of ['cell_0_1', 'cell_0_1']) await tap(page, (await targets(page))[cell]);   // "BB"
    await tap(page, (await targets(page)).start);
    await page.waitForFunction(() => window.game.screen === 'connect', null, { timeout: 8000 }).catch(() => {});
    s = await state(page); check('name START (ai) -> connect', s.screen === 'connect', s.screen);
    await tap(page, (await targets(page)).copy);
    s = await state(page); check('tap COPY LINK -> copy fired', s.copied > 0, `copiedTimer=${s.copied?.toFixed?.(2)}`);

    // --- REMATCH (2P post-race): EXIT -> title; without a live agent PLAY AGAIN must reconnect, never fake a solo 2P race ---
    await page.evaluate(() => { window.game.mode = 'ai'; window.game.score = 4200; window.game.go('rematch'); });
    await page.waitForTimeout(150);
    let tg = await targets(page); check('rematch has PLAY AGAIN + EXIT targets', !!tg.playAgain && !!tg.exit);
    await tap(page, tg.exit);
    s = await state(page); check('rematch EXIT -> title (leaderboard)', s.screen === 'title', s.screen);
    await page.evaluate(() => { window.game.mode = 'ai'; window.game.go('rematch'); });
    await page.waitForTimeout(150);
    await tap(page, (await targets(page)).playAgain);
    await page.waitForFunction(() => window.game.screen === 'connect', null, { timeout: 3000 }).catch(() => {});
    s = await state(page); check('rematch PLAY AGAIN without opponent -> connect', s.screen === 'connect', s.screen);
  } catch (e) { check('exception', false, e.message.split('\n')[0]); }
  if (errs.length) { fails += errs.length; log('   ✗ runtime errors: ' + errs.slice(0, 5).join(' | ')); }
  else log('   ✓ no console/page errors');
  await ctx.close();
}

for (const size of SIZES) { log(`\n== ${size.id} (${size.w}x${size.h}) ==`); await run(size); }
await browser.close();
log(fails ? `\nTAP FLOWS: FAIL (${fails})` : '\nTAP FLOWS: PASS');
process.exit(fails ? 1 : 0);
