import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

console.log('1. Loading Title Screen...');
await page.goto('http://127.0.0.1:3000/');
await page.waitForFunction(() => window.game && window.game.screen === 'title', null, { timeout: 15000 });
await page.waitForTimeout(600);
await page.screenshot({ path: 'artifacts/browser/screen_1_title.png' });
console.log('Saved artifacts/browser/screen_1_title.png');

console.log('2. Advancing to Select Screen (1P / 2P)...');
await page.keyboard.press('Enter');
await page.waitForFunction(() => window.game && window.game.screen === 'menu', null, { timeout: 5000 });
await page.waitForTimeout(400);
await page.screenshot({ path: 'artifacts/browser/screen_2_select_1p.png' });
console.log('Saved artifacts/browser/screen_2_select_1p.png');

console.log('3. Moving cursor to 2 PLAYERS (HUMAN VS AGENT)...');
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(400);
const cursorVal = await page.evaluate(() => window.game.screens.cursor);
console.log('Cursor is now on:', cursorVal === 1 ? '2 PLAYERS' : '1 PLAYER');
await page.screenshot({ path: 'artifacts/browser/screen_3_select_2p.png' });
console.log('Saved artifacts/browser/screen_3_select_2p.png');

console.log('4. Entering 2-Player Connect Screen...');
await page.keyboard.press('Enter');
await page.waitForFunction(() => window.game && window.game.screen === 'connect', null, { timeout: 5000 });
await page.waitForTimeout(600);
await page.screenshot({ path: 'artifacts/browser/screen_4_connect_waiting.png' });
console.log('Saved artifacts/browser/screen_4_connect_waiting.png');

console.log('5. Clicking Copy to Clipboard...');
// Click in upper right area where the yellow button is
// In 960x540 window, image is 4:3 -> centered with letterbox
// Let's trigger copyAgentLink directly or click button
await page.evaluate(() => window.game.screens.copyAgentLink());
await page.waitForTimeout(300);
await page.screenshot({ path: 'artifacts/browser/screen_5_connect_copied.png' });
console.log('Saved artifacts/browser/screen_5_connect_copied.png');

console.log('Page errors:', errors.length ? errors : 'none');
await browser.close();
