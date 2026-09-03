// Live GitHub OAuth E2E against PRODUCTION. Opens a visible Chrome; the human completes GitHub's authorize,
// then we verify the handle came back into the app. node tools/oauth_live.mjs [github|twitter]
import { chromium } from 'playwright-core';
const provider = process.argv[2] || 'github';
const b = await chromium.launch({ channel: 'chrome', headless: false });
const ctx = await b.newContext();
const page = await ctx.newPage();
console.log(`\n>>> A Chrome window is opening. Sign in and click "Authorize" for ${provider.toUpperCase()}. Waiting up to 4 min...\n`);
try {
  await page.goto(`https://marbles.secure.build/auth/${provider}`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(
    (u) => u.hostname.endsWith('marbles.secure.build') && !u.pathname.startsWith('/callback') && !u.pathname.startsWith('/auth'),
    { timeout: 240000 }
  );
  await page.waitForTimeout(2000);
  const cookies = await ctx.cookies();
  const mmUser = cookies.find((c) => c.name === 'mm_user');
  const info = await page.evaluate(() => ({
    mm: (window).__MM__ ? (window).__MM__.user : null,
    name: (window).game ? (window).game.playerName : null,
    url: location.href,
  }));
  const handle = (mmUser && decodeURIComponent(mmUser.value)) || info.mm || info.name;
  await page.screenshot({ path: `artifacts/oauth_${provider}_result.png` });
  const ok = !!handle && handle !== 'PLAYER' && handle !== 'TEST';
  console.log('OAUTH RESULT ' + JSON.stringify({ ok, handle, ...info }));
  console.log(ok ? `\nOAUTH ${provider}: PASS — returned handle "${handle}"` : `\nOAUTH ${provider}: FAIL — no handle came back`);
} catch (e) {
  console.log('OAUTH ' + provider + ': ERROR ' + e.message.split('\n')[0]);
} finally {
  await b.close();
}
