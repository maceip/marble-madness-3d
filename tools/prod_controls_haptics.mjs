// Production-only Playwright checks for the real desktop tutorial/control path and Android-Chromium haptic path.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';

const BASE = process.env.BASE || 'https://marbles.secure.build';
if (!/^https:\/\/marbles\.secure\.build\/?$/i.test(BASE)) throw new Error('This test only runs against https://marbles.secure.build');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let failed = 0;
const check = (name, pass, detail = '') => { console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`); if (!pass) failed++; };

// Desktop: fresh first race must pause behind the tutorial, then both mouse control paths must be directional.
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '/');
  await page.waitForFunction(() => window.game?.screens);
  await page.mouse.click(640, 400); // real user gesture unlocks Web Audio through the visible menu layer
  await page.evaluate(() => { localStorage.removeItem('mm_desktop_trackball_tutorial_v1'); game.mode = '1p'; game.playerName = 'ACE'; game.newGame(0); });
  await page.waitForSelector('#desktop-controls-help:not([hidden])', { timeout: 10000 });
  const before = await page.evaluate(() => ({ t: game.t, speed: Math.hypot(game.input.trackball.wx, game.input.trackball.wy), paused: game.paused }));
  await page.waitForTimeout(500);
  const held = await page.evaluate(() => ({ t: game.t, speed: Math.hypot(game.input.trackball.wx, game.input.trackball.wy), paused: game.paused }));
  check('desktop tutorial pauses the first race', before.paused && held.paused && Math.abs(held.t - before.t) < 0.02, JSON.stringify({ before, held }));
  await page.locator('#desktop-controls-help').hover();
  await page.mouse.wheel(0, 240);
  check('tutorial blocks wheel input', await page.evaluate(() => Math.hypot(game.input.trackball.wx, game.input.trackball.wy) === 0));
  await page.screenshot({ path: 'artifacts/prod-desktop-controls.png' });
  await page.locator('#desktop-controls-dismiss').click();
  await page.waitForTimeout(300);
  check('dismiss resumes the race', await page.evaluate(() => !game.paused && game.t > 0));

  const tb = await page.locator('#trackball').boundingBox();
  if (!tb) check('3D trackball exists', false);
  else {
    await page.evaluate(() => { game.input.trackball.wx = 0; game.input.trackball.wy = 0; });
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
    await page.mouse.down();
    await page.mouse.move(tb.x + tb.width / 2 + 70, tb.y + tb.height / 2, { steps: 10 });
    await page.mouse.up();
    const direct = await page.evaluate(() => ({ wx: game.input.trackball.wx, wy: game.input.trackball.wy, steer: game.input.trackball.getSteer() }));
    check('dragging the 3D ball right steers right', direct.wy > 0 && direct.steer.ax > 0, JSON.stringify(direct));
    await page.waitForTimeout(80);
    const audio = await page.evaluate(() => ({ context: game.sound.ctx?.state, graph: game.sound.trackballAudio?.diagnostics() }));
    check('desktop procedural trackball audio is live', audio.context === 'running' && audio.graph?.speed > 0 && audio.graph?.whineGain > 0 && audio.graph?.pan > 0, JSON.stringify(audio));
  }

  await page.evaluate(() => { game.input.trackball.wx = 0; game.input.trackball.wy = 0; });
  const gameBox = await page.locator('#game').boundingBox();
  if (!gameBox) check('game canvas exists', false);
  else {
    const x = gameBox.x + gameBox.width / 2, y = gameBox.y + gameBox.height / 2;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 90, y, { steps: 8 });
    await page.mouse.wheel(0, 180); await page.mouse.up();
    const forward = await page.evaluate(() => ({ wx: game.input.trackball.wx, wy: game.input.trackball.wy, steer: game.input.trackball.getSteer() }));
    check('click-drag right + wheel down rolls right', forward.wy > 0 && forward.steer.ax > 0, JSON.stringify(forward));
    const speedBeforeReverse = Math.hypot(forward.wx, forward.wy);
    await page.mouse.wheel(0, -180);
    const reverse = await page.evaluate(() => ({ wx: game.input.trackball.wx, wy: game.input.trackball.wy, speed: Math.hypot(game.input.trackball.wx, game.input.trackball.wy) }));
    check('wheel up counter-spins/brakes', reverse.wy < forward.wy && reverse.speed < speedBeforeReverse, JSON.stringify(reverse));
  }

  const desktopCaps = await page.evaluate(() => game.input.trackball.hapticCapabilities());
  check('desktop haptics reports actual actuator availability', desktopCaps.webVibration === false, JSON.stringify(desktopCaps));
  await page.reload(); await page.waitForFunction(() => window.game?.screens);
  await page.evaluate(() => { game.mode = '1p'; game.playerName = 'ACE'; game.newGame(0); });
  await page.waitForFunction(() => game.screen === 'intro' || game.screen === 'race', null, { timeout: 10000 });
  await page.waitForTimeout(300);
  check('desktop tutorial is one-time after dismissal', await page.locator('#desktop-controls-help').isHidden());
  check('desktop path has no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await context.close();
}

await browser.close();

// Actual Android Chrome target against production. Start/forward it with:
//   adb shell am start -n com.android.chrome/com.google.android.apps.chrome.Main -d https://marbles.secure.build/
//   adb forward tcp:9222 localabstract:chrome_devtools_remote
{
  const androidCdp = process.env.ANDROID_CDP_URL || 'http://127.0.0.1:9222';
  let android;
  try { android = await chromium.connectOverCDP(androidCdp); }
  catch (error) { throw new Error(`A real Android Chrome CDP target is required at ${androidCdp}: ${error.message}`); }
  const context = android.contexts()[0];
  await context.addInitScript(() => sessionStorage.setItem('mm_android_app_prompt_dismissed', '1'));
  const page = await context.newPage();
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 20000 }); await page.waitForFunction(() => window.game?.screens);
  await page.evaluate(() => {
    sessionStorage.setItem('mm_android_app_prompt_dismissed', '1');
    const prompt = document.getElementById('android-app-prompt');
    if (prompt) prompt.hidden = true;
  });
  await page.evaluate(() => { localStorage.setItem('mm_haptics', '1'); game.input.trackball.enableHaptics = true; game.mode = '1p'; game.playerName = 'ACE'; game.newGame(0); });
  await page.waitForFunction(() => game.screen === 'intro' || game.screen === 'race', null, { timeout: 10000 });
  const caps = await page.evaluate(() => game.input.trackball.hapticCapabilities());
  check('Android web detects the Vibration API', caps.webVibration && caps.supported, JSON.stringify(caps));
  await page.evaluate(() => {
    window.__vibrationCalls = [];
    const real = navigator.vibrate.bind(navigator);
    navigator.vibrate = (pattern) => { const result = real(pattern); window.__vibrationCalls.push({ pattern, result }); return result; };
  });
  const box = await page.locator('#trackball').boundingBox();
  if (!box) check('mobile trackball exists', false);
  else {
    // Feed a real Android OS swipe, not a DOM-synthesized event. Playwright observes the production page.
    const metrics = await page.evaluate(() => ({ dpr: devicePixelRatio, screenH: screen.height, innerH: innerHeight }));
    const contentTop = Math.round((metrics.screenH - metrics.innerH) * metrics.dpr * 0.45);
    const x = Math.round((box.x + box.width * 0.35) * metrics.dpr);
    const y = Math.round((box.y + box.height * 0.5) * metrics.dpr + contentTop);
    const x2 = Math.round(x + box.width * 0.45 * metrics.dpr);
    execFileSync('adb', ['shell', 'input', 'swipe', String(x), String(y), String(x2), String(y), '250']);
  }
  await page.waitForTimeout(80);
  const mobile = await page.evaluate(() => ({ calls: window.__vibrationCalls, speed: Math.hypot(game.input.trackball.wx, game.input.trackball.wy), desktopHelp: !document.getElementById('desktop-controls-help').hidden, audioContext: game.sound.ctx?.state, audio: game.sound.trackballAudio?.diagnostics() }));
  check('real touch path spins the mobile trackball', mobile.speed > 0.1, JSON.stringify(mobile));
  check('real touch path invokes navigator.vibrate successfully', mobile.calls.some((x) => x.result === true), JSON.stringify(mobile.calls));
  check('finger lift explicitly cancels web vibration', mobile.calls.some((x) => x.pattern === 0), JSON.stringify(mobile.calls));
  check('Android procedural trackball audio is live', mobile.audioContext === 'running' && mobile.audio?.speed > 0 && mobile.audio?.whineGain > 0, JSON.stringify(mobile.audio));
  check('desktop tutorial never appears on mobile', !mobile.desktopHelp);
  check('test ran in actual Android Chrome', await page.evaluate(() => /Android/.test(navigator.userAgent)), await page.evaluate(() => navigator.userAgent));
  await page.close();
}

console.log(failed ? `PROD CONTROLS/HAPTICS: FAIL (${failed})` : 'PROD CONTROLS/HAPTICS: PASS');
process.exit(failed ? 1 : 0);
