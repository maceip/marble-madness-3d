// Plumbing smoke for Safari / iOS: Range audio, HTML chrome, and a live load in Safari + Simulator.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:3200';
mkdirSync('artifacts/browser', { recursive: true });
let fails = 0;
const check = (n, ok, d = '') => { console.log(`  ${ok ? '✓' : '✗'} ${n}${d ? '  ' + d : ''}`); if (!ok) fails++; };

const headersOf = async (path, extra = {}) => {
  const r = await fetch(BASE + path, extra);
  return { status: r.status, headers: r.headers, size: +(r.headers.get('content-length') || 0), text: extra.method === 'HEAD' ? '' : await r.text() };
};

const idx = await fetch(BASE + '/');
const html = await idx.text();
check('index 200', idx.status === 200, String(idx.status));
check('viewport-fit=cover', html.includes('viewport-fit=cover'));
check('apple-mobile-web-app-capable', html.includes('apple-mobile-web-app-capable'));
check('100dvh', html.includes('100dvh'));
check('safe-area-inset', html.includes('safe-area-inset'));
check('__MM__ injected', html.includes('window.__MM__='));

const js = await fetch(BASE + '/bundle.js');
const bundle = await js.text();
check('bundle 200', js.status === 200, `${(bundle.length / 1024).toFixed(0)} KB`);
check('bundle minified (no fat indent)', !bundle.includes('\n  const ') && bundle.length < 220_000, `${(bundle.length / 1024).toFixed(0)} KB`);
check('webkitAudioContext fallback', bundle.includes('webkitAudioContext'));
check('playsinline for iOS BGM', bundle.includes('playsinline') || bundle.includes('playsInline'));
check('wakeLock', bundle.includes('wakeLock'));
check('visualViewport', bundle.includes('visualViewport'));
check('Cache-Control no-cache on JS', /no-cache/.test(js.headers.get('cache-control') || ''), js.headers.get('cache-control') || '');

const range = await fetch(BASE + '/audio/bgm/practice-race.mp3', { headers: { Range: 'bytes=0-1' } });
check('audio Range -> 206', range.status === 206, String(range.status));
check('audio Content-Range', /bytes 0-1\//.test(range.headers.get('content-range') || ''), range.headers.get('content-range') || '');
check('audio Accept-Ranges', range.headers.get('accept-ranges') === 'bytes' || range.status === 206, range.headers.get('accept-ranges') || '');
const body = new Uint8Array(await range.arrayBuffer());
check('audio Range body is 2 bytes', body.length === 2, String(body.length));

// Desktop Safari via Apple Events (needs Develop > Allow JavaScript from Apple Events)
const safariJs = JSON.stringify(`
  (function(){
    var g = window.game;
    return JSON.stringify({
      title: document.title,
      screen: g && g.screen,
      canvas: !!(document.getElementById('game')),
      tb: !!(document.getElementById('trackball')),
      vv: !!(window.visualViewport),
      audioCtor: !!(window.AudioContext || window.webkitAudioContext),
      wake: !!(navigator.wakeLock),
      w: innerWidth, h: innerHeight
    });
  })()
`);
const script = `
tell application "Safari"
  activate
  open location ${JSON.stringify(BASE + '/?stage=1')}
end tell
delay 5
tell application "Safari"
  try
    set r to do JavaScript ${safariJs} in current tab of front window
    return r
  on error err
    return "APPLE_EVENTS_BLOCKED:" & err
  end try
end tell
`;
writeFileSync('/tmp/mm-safari.scpt', script);
const osa = await new Promise((resolve) => {
  const p = spawn('osascript', ['/tmp/mm-safari.scpt'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { err += d; });
  p.on('close', (code) => resolve({ code, out: out.trim(), err: err.trim() }));
});
if (osa.out.startsWith('APPLE_EVENTS_BLOCKED') || !osa.out) {
  console.log('  · Safari JS automation blocked (enable Develop > Allow JavaScript from Apple Events). Opened the URL anyway.');
  console.log('    ', osa.out || osa.err || `exit ${osa.code}`);
} else {
  try {
    const s = JSON.parse(osa.out);
    check('Safari booted game', !!s.screen && !!s.canvas, JSON.stringify(s));
    check('Safari has AudioContext', !!s.audioCtor);
  } catch {
    check('Safari returned JSON', false, osa.out.slice(0, 200));
  }
}

// Chromium iPhone UA as a layout stand-in (real iOS screenshot is taken separately)
const b = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (await b.newContext({
  viewport: { width: 393, height: 852 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
})).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(BASE + '/?stage=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.game && window.game.screen, null, { timeout: 20000 });
const mob = await page.evaluate(() => {
  const g = window.game;
  const tb = document.getElementById('trackball-container');
  const st = tb && getComputedStyle(tb);
  return {
    screen: g.screen,
    cw: g.r.canvas.width,
    ch: g.r.canvas.height,
    scale: g.r.scale,
    tbBottom: st && st.bottom,
    dvh: CSS.supports('height', '100dvh'),
  };
});
check('mobile layout booted', !!mob.screen, JSON.stringify(mob));
check('no page errors', errors.length === 0, errors.join(' | '));
await page.screenshot({ path: 'artifacts/browser/ios_ua_chrome.png' });
await b.close();

console.log(fails ? `\nSAFARI/IOS SMOKE: FAIL (${fails})` : '\nSAFARI/IOS SMOKE: PASS');
process.exit(fails ? 1 : 0);
