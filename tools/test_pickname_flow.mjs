import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

mkdirSync('artifacts/browser', { recursive: true });

async function run() {
  console.log('Launching browser to test pickname flow with Playwright...');
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
  });

  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto('http://127.0.0.1:3000/');
  await page.waitForFunction(() => window.game && window.game.screen !== 'boot', null, { timeout: 20000 });
  await page.waitForTimeout(400);

  // 1. Ensure top-right auth-dock is NOT present anywhere in the DOM
  const authDock = await page.$('#auth-dock');
  console.log('Top right auth-dock exists in DOM:', !!authDock);
  if (authDock) {
    throw new Error('Expected auth-dock to be removed from top right');
  }

  await page.screenshot({ path: 'artifacts/browser/01_title_leaderboard.png' });
  console.log('Saved artifacts/browser/01_title_leaderboard.png');

  // 2. Press Enter to go to Mode Select (menu)
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);

  let state = await page.evaluate(() => window.game?.screen);
  console.log('Screen after pressing Enter on title:', state);
  await page.screenshot({ path: 'artifacts/browser/02_mode_select.png' });
  console.log('Saved artifacts/browser/02_mode_select.png');

  // 3. Select 1 PLAYER to go to Pick Name screen
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);

  state = await page.evaluate(() => window.game?.screen);
  console.log('Screen after selecting 1 PLAYER:', state);
  if (state !== 'name') {
    throw new Error(`Expected screen 'name', got '${state}'`);
  }

  await page.screenshot({ path: 'artifacts/browser/03_pickname_initial.png' });
  console.log('Saved artifacts/browser/03_pickname_initial.png');

  // 4. Type name "ALEX"
  for (const ch of ['A', 'L', 'E', 'X']) {
    await page.keyboard.press(`Key${ch}`);
    await page.waitForTimeout(100);
  }

  const playerName = await page.evaluate(() => window.game?.playerName);
  console.log('Player name after typing ALEX:', playerName);

  await page.screenshot({ path: 'artifacts/browser/04_pickname_typed_alex.png' });
  console.log('Saved artifacts/browser/04_pickname_typed_alex.png');

  // 5. Test clicking RUB on the canvas
  const canvas = await page.$('#game');
  const box = await canvas.boundingBox();
  console.log('Canvas bounding box:', box);

  const imgW = 1573, imgH = 1000;
  const scale = Math.min(box.width / imgW, box.height / imgH);
  const rw = imgW * scale, rh = imgH * scale;
  const rx = box.x + (box.width - rw) / 2;
  const ry = box.y + (box.height - rh) / 2;

  // RUB is at col 5, row 3: x=1067, y=759
  const rubX = rx + (1067 / imgW) * rw;
  const rubY = ry + (759 / imgH) * rh;

  console.log('Clicking RUB at:', rubX, rubY);
  await page.mouse.click(rubX, rubY);
  await page.waitForTimeout(300);

  const afterRub = await page.evaluate(() => window.game?.playerName);
  console.log('Player name after clicking RUB:', afterRub);

  await page.screenshot({ path: 'artifacts/browser/05_pickname_after_rub.png' });
  console.log('Saved artifacts/browser/05_pickname_after_rub.png');

  // 6. Press 'X' and Enter to confirm name and start game
  await page.keyboard.press('KeyX');
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);

  const finalScreen = await page.evaluate(() => window.game?.screen);
  console.log('Final screen after confirming name:', finalScreen);

  await page.screenshot({ path: 'artifacts/browser/06_game_started.png' });
  console.log('Saved artifacts/browser/06_game_started.png');

  await browser.close();

  if (pageErrors.length > 0) {
    console.error('Page errors encountered:', pageErrors);
    process.exit(1);
  }

  console.log('All pickname flow tests passed successfully!');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
