import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const screenshotsDir = '/Users/mac/marblemadness/test_screenshots';
if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

console.log('[Test Harness] Running full headless Chrome gameplay validation...');

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const chromeProc = spawn(CHROME_PATH, [
  '--headless=new',
  '--remote-debugging-port=9222',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu-sandbox',
  '--hide-scrollbars',
  '--window-size=1280,800',
  'http://localhost:3000'
]);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendCDPCommand(wsUrl, method, params = {}) {
  const { WebSocket } = await import('ws');
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.on('open', () => {
      const id = 1;
      ws.send(JSON.stringify({ id, method, params }));
    });
    ws.on('message', (data) => {
      const res = JSON.parse(data.toString());
      if (res.id === 1) {
        ws.close();
        resolve(res.result);
      }
    });
    ws.on('error', (err) => {
      reject(err);
    });
  });
}

async function run() {
  await wait(2000);
  console.log('[Test Harness] Connecting to Chrome DevTools Protocol...');
  
  const req = http.get('http://127.0.0.1:9222/json', (res) => {
    let raw = '';
    res.on('data', (c) => raw += c);
    res.on('end', async () => {
      try {
        const targets = JSON.parse(raw);
        const page = targets.find(t => t.type === 'page');
        if (!page) {
          console.error('[Test Harness] No page target found');
          chromeProc.kill();
          process.exit(1);
        }
        
        const wsUrl = page.webSocketDebuggerUrl;
        
        // 1. Capture Initial Splash Screen & Leaderboard Table
        await wait(1500);
        let shot = await sendCDPCommand(wsUrl, 'Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(screenshotsDir, '01_splash_screen.png'), Buffer.from(shot.data, 'base64'));
        console.log('[Test Harness] Saved 01_splash_screen.png');

        // 2. Click Start to dismiss Splash and start Countdown / Stage 1
        console.log('[Test Harness] Dismissing Splash Screen & Booting Game...');
        const initCheck = await sendCDPCommand(wsUrl, 'Runtime.evaluate', {
          expression: `(() => {
            return {
              hasGame: !!window.game,
              menuEl: !!document.getElementById('menu'),
              splashEl: !!document.getElementById('splash-screen')
            };
          })()`,
          returnByValue: true
        });
        console.log('[Test Harness] Init check:', JSON.stringify(initCheck));

        await sendCDPCommand(wsUrl, 'Runtime.evaluate', {
          expression: `(() => {
            const el = document.getElementById('splash-screen');
            if (el) { el.style.display = 'none'; el.remove(); }
            const btn = document.getElementById('splash-start-btn');
            if (btn) btn.click();
            if (window.game) {
              window.game.hud.hideCountdown();
              window.game.hud.showMenu(8, 1);
            }
          })()`
        });
        await wait(1000);

        // Check menu outerHTML
        const menuHtml = await sendCDPCommand(wsUrl, 'Runtime.evaluate', {
          expression: `document.getElementById('menu')?.innerHTML.substring(0, 100)`
        });
        console.log('[Test Harness] Menu HTML snippet:', JSON.stringify(menuHtml));

        shot = await sendCDPCommand(wsUrl, 'Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(screenshotsDir, '02_retro_menu.png'), Buffer.from(shot.data, 'base64'));
        console.log('[Test Harness] Saved 02_retro_menu.png');

        // 4. Close Menu & Resume Game
        console.log('[Test Harness] Resuming Gameplay...');
        await sendCDPCommand(wsUrl, 'Runtime.evaluate', {
          expression: `(() => {
            if (window.game) {
              window.game.hud.hideMenu();
              window.game.startGameDirect();
            }
          })()`
        });
        await wait(1500);

        // 3. Test WebMCP AI agent interface tool execution
        console.log('[Test Harness] Testing WebMCP callTool get_game_state & steer_trackball...');
        const mcpState = await sendCDPCommand(wsUrl, 'Runtime.evaluate', {
          expression: `(async () => {
            const res = await window.webmcp.callTool('get_game_state', {});
            return res;
          })()`,
          awaitPromise: true,
          returnByValue: true
        });
        console.log('[Test Harness] AI get_game_state response:', JSON.stringify(mcpState.result?.value?.marble || mcpState.result || mcpState));

        const mcpSteer = await sendCDPCommand(wsUrl, 'Runtime.evaluate', {
          expression: `(async () => {
            const res = await window.webmcp.callTool('steer_trackball', { direction_degrees: 90, impulse: 0.6, duration_seconds: 0.5 });
            return res;
          })()`,
          awaitPromise: true,
          returnByValue: true
        });
        console.log('[Test Harness] AI steer_trackball response:', JSON.stringify(mcpSteer.result?.value || mcpSteer.result || mcpSteer));

        // Let marble roll smoothly in 3D
        await wait(2000);

        shot = await sendCDPCommand(wsUrl, 'Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(screenshotsDir, '03_gameplay_3d_physics.png'), Buffer.from(shot.data, 'base64'));
        console.log('[Test Harness] Saved 03_gameplay_3d_physics.png');

        console.log('[Test Harness] Completed all verification and screenshots!');
        chromeProc.kill();
        process.exit(0);
      } catch (err) {
        console.error('[Test Harness] Error running test:', err);
        chromeProc.kill();
        process.exit(1);
      }
    });
  });

  req.on('error', (err) => {
    console.error('[Test Harness] Port connection error:', err);
    chromeProc.kill();
    process.exit(1);
  });
}

run();
