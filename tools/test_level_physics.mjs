import { chromium } from 'playwright-core';

console.log('Launching browser harness test for level physics...');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

// Navigate to the physics test harness page with autorun=1
await page.goto('http://127.0.0.1:3000/physics-harness.html?autorun=1');

// Wait for test results
console.log('Executing comprehensive physics verification suite...');
await page.waitForFunction(() => window.__PHYSICS_TEST_RESULTS__ && window.__PHYSICS_TEST_RESULTS__.total > 0, null, { timeout: 30000 });

const results = await page.evaluate(() => window.__PHYSICS_TEST_RESULTS__);

console.log(`\n======================================================`);
console.log(`PHYSICS VERIFICATION TEST RESULTS (${results.passed}/${results.total} PASSED)`);
console.log(`======================================================`);

for (const t of results.tests) {
  const mark = t.passed ? '✅ PASS' : '❌ FAIL';
  console.log(`\n${mark}: ${t.name}`);
  if (t.passed) {
    console.log(`   ${t.details.replace(/&bull;/g, '*').replace(/<[^>]+>/g, '')}`);
  } else {
    console.log(`   ERROR: ${t.error}`);
  }
}

// Save screenshot of the visual test dashboard
await page.screenshot({ path: 'artifacts/browser/physics_harness_dashboard.png' });
console.log('\nSaved screenshot: artifacts/browser/physics_harness_dashboard.png');

if (errors.length) {
  console.error('\nPage errors detected:', errors);
}

await browser.close();

if (results.failed > 0 || errors.length > 0) {
  console.error(`\n❌ Physics harness test FAILED: ${results.failed} test(s) failed.`);
  process.exit(1);
} else {
  console.log(`\n🎉 All ${results.passed} physics verification tests PASSED with zero errors!`);
  process.exit(0);
}
