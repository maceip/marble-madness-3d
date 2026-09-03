// Verifies back-press handling: back walks screens to the root, then shows an exit-confirm modal (never exits);
// the agent page treats back as a no-op. node tools/back_nav.mjs
import { chromium } from 'playwright-core';
const BASE = process.env.BASE || 'http://127.0.0.1:3200';
const b = await chromium.launch({ channel: 'chrome', headless: true });
let fails = 0; const check = (n, ok, d = '') => { console.log(`  ${ok ? '✓' : '✗'} ${n}${d ? '  ' + d : ''}`); if (!ok) fails++; };
const back = async (p) => { await p.evaluate(() => history.back()); await p.waitForTimeout(250); };
const screen = (p) => p.evaluate(() => window.game.screen);

// human flow
{
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });
  await p.goto(BASE + '/'); await p.waitForFunction(() => window.game && typeof window.game.go === 'function' && window.game.stage);
  await p.evaluate(() => window.game.go('control'));   // deep screen
  check('setup at control', await screen(p) === 'control');
  await back(p); check('back: control -> name', await screen(p) === 'name', await screen(p));
  await back(p); check('back: name -> menu', await screen(p) === 'menu', await screen(p));
  await back(p); check('back: menu -> title', await screen(p) === 'title', await screen(p));
  await back(p); const modal = await p.evaluate(() => { const m = document.getElementById('exit-modal'); return m ? getComputedStyle(m).display : 'none'; });
  check('back at root: exit-confirm modal shown', modal === 'flex', 'display=' + modal);
  check('still in app (screen title, not navigated away)', await screen(p) === 'title');
  await p.evaluate(() => document.querySelector('#exit-modal button')?.click());  // CANCEL
  await p.waitForTimeout(100);
  const closed = await p.evaluate(() => getComputedStyle(document.getElementById('exit-modal')).display);
  check('CANCEL closes modal', closed === 'none', 'display=' + closed);
  check('no console/page errors', errs.length === 0, errs[0] || '');
  await ctx.close();
}
// agent page: back is a no-op
{
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.goto(BASE + '/11111111-2222-3333-4444-555555555555'); await p.waitForFunction(() => window.game && window.game.stage);
  await p.waitForTimeout(300);
  const before = await screen(p);
  await back(p);
  check('agent back is a no-op (stays)', await screen(p) === before, `${before} -> ${await screen(p)}`);
  await ctx.close();
}
await b.close();
console.log(fails ? `\nBACK NAV: FAIL (${fails})` : '\nBACK NAV: PASS');
process.exit(fails ? 1 : 0);
