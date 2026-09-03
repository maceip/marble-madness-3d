import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });

await page.goto('http://127.0.0.1:3000/');
await page.waitForFunction(() => window.game && window.game.screen === 'title', null, { timeout: 15000 });

// Click on the twitter-btn
await Promise.all([
  page.waitForNavigation(),
  page.click('#twitter-btn')
]);

console.log('Navigated URL:', page.url());
await page.screenshot({ path: 'artifacts/browser/twitter_auth_page.png' });
console.log('Saved artifacts/browser/twitter_auth_page.png');

await browser.close();
