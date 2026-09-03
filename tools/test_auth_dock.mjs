import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });

await page.goto('http://127.0.0.1:3000/');
await page.waitForFunction(() => window.game && window.game.screen === 'title', null, { timeout: 15000 });

await page.waitForTimeout(1000);
await page.screenshot({ path: 'artifacts/browser/title_auth_dock.png' });
console.log('Saved artifacts/browser/title_auth_dock.png');

await browser.close();
