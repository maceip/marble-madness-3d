import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

// 1. Visit with user handle
await page.goto('http://127.0.0.1:3000/?user=@MACEIP');
await page.waitForFunction(() => window.game && window.game.screen === 'title', null, { timeout: 15000 });

// Wait a moment for assets and fonts
await page.waitForTimeout(1000);

const handleText = await page.$eval('#twitter-handle', el => el.textContent);
console.log('Twitter handle displayed:', handleText);

await page.screenshot({ path: 'artifacts/browser/title_twitter_connected.png' });
console.log('Saved artifacts/browser/title_twitter_connected.png');

console.log('Page errors:', errors.length ? errors : 'none');
await browser.close();
