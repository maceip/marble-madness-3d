import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

// Test 1: Stage 3 Tower start and ramp slide
console.log('Testing Stage 3 Tower Start...');
await page.goto('http://127.0.0.1:3000/?stage=3');
await page.waitForFunction(() => window.game && window.game.screen === 'race', null, { timeout: 25000 });

const startState = await page.evaluate(() => {
  const g = window.game;
  return {
    stage: g.stage.name,
    hasSlide: !!g.marble.slide,
    pos: { u: +g.marble.u.toFixed(2), v: +g.marble.v.toFixed(2), z: +g.marble.z.toFixed(2) }
  };
});
console.log('Stage 3 start state:', startState);

// Wait for slide to finish landing on maze platform
await page.waitForFunction(() => window.game && !window.game.marble.slide, null, { timeout: 10000 });
const landedState = await page.evaluate(() => {
  const g = window.game;
  return {
    dizzy: g.marble.dizzyT > 0,
    pos: { u: +g.marble.u.toFixed(2), v: +g.marble.v.toFixed(2), z: +g.marble.z.toFixed(2) }
  };
});
console.log('Stage 3 landed state on maze platform:', landedState);

// Test 2: Goal Sign Color Shift on Stage 1 or 2 finish
console.log('Testing Goal Sign Color Shift...');
await page.goto('http://127.0.0.1:3000/?stage=1');
await page.waitForFunction(() => window.game && window.game.screen === 'race', null, { timeout: 25000 });

// Teleport marble right in front of goal
await page.evaluate(() => {
  const g = window.game;
  const goal = g.stage.zones.find(z => z.kind === 'goal');
  g.marble.place(goal.u0 + 1, goal.v0 + 1, 38);
});
await page.waitForFunction(() => window.game && window.game.goalReached, null, { timeout: 10000 });

const goalState = await page.evaluate(() => {
  const g = window.game;
  return {
    goalReached: g.goalReached,
    finished: g.finished,
    hasLitGoal: !!g.litGoalBlue
  };
});
console.log('Goal reached state:', goalState);

await page.waitForTimeout(500);
await page.screenshot({ path: 'artifacts/browser/goal_lit_blue_test.png' });
console.log('Saved screenshot artifacts/browser/goal_lit_blue_test.png');

console.log('Page errors:', errors.length ? errors : 'none');
await browser.close();
