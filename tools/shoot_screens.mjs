// Real-client screen audit. Renders EVERY non-game screen across the full supported size matrix and all four
// client contexts (mobile browser, desktop browser, Android APK WebView path, Codex agent embedded path),
// using the real game object (never undefined / the canvas), captures per-shot console+page errors, verifies
// the agent guard, and writes montages for review. Exits non-zero on ANY error or blank/failed render.
//
//   BASE=http://127.0.0.1:3200 node tools/shoot_screens.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:3200';
const OUT = 'artifacts/screens';
const num = (v) => typeof v === 'number' && Number.isFinite(v);

// supported client sizes. portrait path triggers when h > w*1.15.
const SIZES = [
  { id: 'phone-sm',   w: 375,  h: 667,  m: true,  label: 'phone 375x667 (SE)' },
  { id: 'phone-md',   w: 412,  h: 915,  m: true,  label: 'phone 412x915 (Pixel7)' },
  { id: 'phone-lg',   w: 430,  h: 932,  m: true,  label: 'phone 430x932 (ProMax)' },
  { id: 'phone-land', w: 844,  h: 390,  m: true,  label: 'phone landscape 844x390' },
  { id: 'fold-open',  w: 790,  h: 844,  m: true,  label: 'Pixel 9 Pro Fold unfolded 790x844' },
  { id: 'fold-land',  w: 883,  h: 736,  m: true,  label: 'Pixel Fold unfolded landscape 883x736' },
  { id: 'tablet',     w: 820,  h: 1180, m: true,  label: 'tablet 820x1180 (iPad Air)' },
  { id: 'desktop',    w: 1366, h: 768,  m: false, label: 'desktop 1366x768' },
];
const SCREENS = ['title', 'menu', 'name', 'control', 'connect', 'gameover', 'congrats', 'rematch'];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];   // {ctx,size,screen,ok,errs,blank}
let hardFail = false;
const log = (s) => process.stdout.write(s + '\n');

// seed realistic state so end screens/leaderboard aren't empty
const SEED = `(() => { const g = window.game;
  g.playerName = '@MACEIP';
  g.score = 60000; g.displayScore = 60000; g.deaths = 3; g.stageIdx = 5; g.timeLeft = 42; g.carried = 4200;
  g.finalTally = { total: 128400, drained: 55000 };
  g.aiDestroyed = 2; g.aiDizzied = 4;
  g.scoreSubmitted = true;   // don't POST the leaderboard from the render audit (avoids rate-limit noise)
})()`;

async function ready(page) {
  await page.waitForFunction(() => {
    const g = window.game; return g && typeof g.go === 'function' && g.stage && g.marble;
  }, null, { timeout: 20000 });
}

// how "full" the frame is: fraction of non-black pixels (guards blank screens)
async function coverage(page) {
  return page.evaluate(() => {
    const c = document.getElementById('game'); if (!c) return 0;
    const ctx = c.getContext('2d'); const s = 64;
    const off = document.createElement('canvas'); off.width = s; off.height = s;
    const o = off.getContext('2d'); o.drawImage(c, 0, 0, s, s);
    const d = o.getImageData(0, 0, s, s).data; let lit = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i+1] + d[i+2] > 36) lit++;
    return lit / (s * s);
  }).catch(() => 0);
}

async function shoot(ctxLabel, url, size, screen, opts = {}) {
  const context = await browser.newContext({ viewport: { width: size.w, height: size.h }, isMobile: size.m, hasTouch: size.m, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 160)); });
  let blank = 1, guardOK = null;
  try {
    await page.goto(url, { waitUntil: 'load' });
    await ready(page);
    await page.evaluate(SEED);
    if (opts.agentGuard) {
      // force a human screen; the agent must be bounced to connect
      const landed = await page.evaluate(() => { window.game.go('title'); window.game.go('menu'); window.game.go('congrats'); return window.game.screen; });
      guardOK = landed === 'connect';
    }
    await page.evaluate((s) => window.game.go(s), screen);
    await page.waitForTimeout(1300);   // let enter()+DOM panels+tally settle
    const shot = await page.evaluate(() => window.game.screen);
    blank = 1 - await coverage(page);
    const file = `${OUT}/${ctxLabel}__${screen}__${size.id}.png`;
    await page.screenshot({ path: file });
    const landedRight = shot === screen || (opts.agentGuard && shot === 'connect');
    const ok = errs.length === 0 && blank < 0.997 && landedRight && (guardOK !== false);
    if (!ok) hardFail = true;
    results.push({ ctx: ctxLabel, size: size.id, screen, ok, errs: errs.slice(0, 4), blank: +blank.toFixed(3), shot, guardOK, file });
    log(`  ${ok ? '✓' : '✗'} ${ctxLabel} ${size.id} ${screen}  lit=${(100*(1-blank)).toFixed(0)}%${errs.length ? '  ERR:' + errs[0] : ''}${guardOK != null ? '  guard=' + guardOK : ''}`);
  } catch (e) {
    hardFail = true; results.push({ ctx: ctxLabel, size: size.id, screen, ok: false, errs: ['EXC ' + e.message] });
    log(`  ✗ ${ctxLabel} ${size.id} ${screen}  EXC ${e.message.split('\n')[0]}`);
  }
  await context.close();
}

// 1) HUMAN browser (mobile + desktop) — full matrix
log('== human browser (mobile + desktop) ==');
for (const size of SIZES) for (const screen of SCREENS) await shoot('browser', `${BASE}/`, size, screen);

// 2) Android APK WebView path (same Chromium; adds ?platform=android_apk&install=1) — phone size, all screens
log('== android apk webview path ==');
for (const screen of SCREENS) await shoot('apk', `${BASE}/?platform=android_apk&install=1`, SIZES[1], screen);

// 3) Codex agent embedded browser — /<uuid> sets fromPath=true; only 'connect' is visible + guard must hold
log('== codex agent embedded (/<lobby>) ==');
const lobby = '11111111-2222-3333-4444-555555555555';
for (const size of [SIZES[5], SIZES[1]]) await shoot('agent', `${BASE}/${lobby}`, size, 'connect', { agentGuard: true });

await browser.close();

// montage per screen (all human sizes) + apk + agent, via an HTML gallery screenshotted in one pass.
// images are inlined as base64 data URIs — file:// srcs do not load inside setContent() in headless.
const galleryBrowser = await chromium.launch({ channel: 'chrome', headless: true });
const dataUri = (f) => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
async function montage(name, cells) {
  const gp = await (await galleryBrowser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })).newPage();
  const html = `<body style="margin:0;background:#111;font-family:monospace;color:#ccc">
    <div style="display:flex;flex-wrap:wrap;gap:8px;padding:10px">` +
    cells.map(c => `<figure style="margin:0"><img src="${dataUri(c.file)}" style="height:340px;border:2px solid ${c.ok ? '#2a2' : '#c33'};background:#000"><figcaption style="font-size:12px;padding:3px">${c.label} ${c.ok ? '' : '⚠'}</figcaption></figure>`).join('') +
    `</div></body>`;
  await gp.setContent(html);
  await gp.waitForTimeout(400);
  await gp.screenshot({ path: `${OUT}/montage/${name}.png`, fullPage: true });
  await gp.close();
}
for (const screen of SCREENS) {
  const cells = results.filter(r => r.ctx === 'browser' && r.screen === screen && r.file)
    .map(r => ({ file: r.file, ok: r.ok, label: r.size }));
  if (cells.length) await montage(`screen_${screen}`, cells);
}
await montage('context_apk', results.filter(r => r.ctx === 'apk' && r.file).map(r => ({ file: r.file, ok: r.ok, label: 'apk ' + r.screen })));
await montage('context_agent', results.filter(r => r.ctx === 'agent' && r.file).map(r => ({ file: r.file, ok: r.ok, label: 'agent ' + r.size })));
await galleryBrowser.close();

fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(results, null, 2));
const bad = results.filter(r => !r.ok);
log(`\n${results.length} shots, ${bad.length} problems`);
for (const b of bad) log(`  FAIL ${b.ctx}/${b.size}/${b.screen}: ${(b.errs && b.errs[0]) || ('blank=' + b.blank + ' shot=' + b.shot + ' guard=' + b.guardOK)}`);
log(hardFail ? '\nSCREEN AUDIT: FAIL' : '\nSCREEN AUDIT: PASS');
process.exit(hardFail ? 1 : 0);
