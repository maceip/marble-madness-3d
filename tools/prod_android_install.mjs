// Production-only Playwright acceptance coverage for the Android install nudge.
import { chromium } from 'playwright-core';

const BASE = 'https://marbles.secure.build';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let failed = 0;
const check = (name, pass, detail = '') => { console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`); if (!pass) failed++; };

const android = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true, userAgent: ANDROID_UA });
const page = await android.newPage();
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('#android-app-prompt:not([hidden])');
const banner = await page.evaluate(() => {
  const host = document.getElementById('android-app-prompt');
  const card = document.querySelector('.android-app-card');
  const rect = card?.getBoundingClientRect().toJSON();
  return {
    rect, innerWidth, innerHeight, scrollWidth: document.documentElement.scrollWidth,
    role: host?.getAttribute('role'),
    benefits: document.querySelector('.android-app-benefits')?.getAttribute('aria-label'),
    pwa: document.getElementById('android-app-pwa-note')?.getAttribute('aria-label'),
  };
});
check('Android website shows a compact, contained, non-modal bottom banner', banner.role === 'complementary' && banner.rect?.height <= 110 && banner.rect?.left >= 0 && banner.rect?.right <= banner.innerWidth && banner.rect?.bottom <= banner.innerHeight && banner.scrollWidth <= banner.innerWidth, JSON.stringify(banner));
check('banner advertises rich haptics, minimal binary size, and no ads', banner.benefits === 'Rich haptics, minimal binary size, and no ads');
check('ordinary Android browser conditionally asks the user to delete an installed PWA', banner.pwa === 'If the PWA is installed, delete it after installing the Android app');
check('install action targets the correct Play package', await page.locator('#android-app-open').getAttribute('href') === 'https://play.google.com/store/apps/details?id=build.secure.marbles');
await page.screenshot({ path: 'artifacts/prod-android-install-banner.png' });
await page.locator('#android-app-dismiss').click();
check('dismiss immediately hides the banner', await page.locator('#android-app-prompt').isHidden());
await page.reload();
await page.waitForTimeout(900);
check('dismissal lasts for the current browser session', await page.locator('#android-app-prompt').isHidden());
await android.close();

const pwa = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true, userAgent: ANDROID_UA });
await pwa.addInitScript(() => {
  const real = window.matchMedia.bind(window);
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: (query) => query === '(display-mode: standalone)'
    ? { matches: true, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } }
    : real(query) });
});
const pwaPage = await pwa.newPage();
await pwaPage.goto(BASE, { waitUntil: 'load' });
await pwaPage.waitForSelector('#android-app-prompt:not([hidden])');
check('installed Android PWA still receives the native-app nudge', await pwaPage.locator('#android-app-prompt').isVisible());
check('installed PWA receives an explicit removal instruction', await pwaPage.locator('#android-app-pwa-note').getAttribute('aria-label') === 'Remove this installed PWA after installing the Android app');
await pwa.close();

const native = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true, userAgent: ANDROID_UA });
const nativePage = await native.newPage();
await nativePage.goto(`${BASE}/?platform=android_apk`, { waitUntil: 'load' });
await nativePage.waitForTimeout(900);
check('native Android host never advertises installing itself', await nativePage.locator('#android-app-prompt').isHidden());
await native.close();

const desktop = await browser.newContext({ viewport: { width: 1180, height: 820 } });
const desktopPage = await desktop.newPage();
await desktopPage.goto(BASE, { waitUntil: 'load' });
await desktopPage.waitForTimeout(900);
check('desktop website does not show the Android banner', await desktopPage.locator('#android-app-prompt').isHidden());
await desktop.close();

await browser.close();
console.log(failed ? `ANDROID INSTALL PROD: FAIL (${failed})` : 'ANDROID INSTALL PROD: PASS');
process.exit(failed ? 1 : 0);
