import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright-core';

const root = resolve(import.meta.dirname, '..');
const port = Number(process.env.HARNESS_PORT || 39177);
const baseUrl = process.env.GAME_URL || `http://127.0.0.1:${port}`;
const artifactDir = resolve(process.env.ARTIFACT_DIR || `${root}/artifacts/browser`);
const tuned = process.env.EXPECT_TUNED === '1';
const errors = [];
let server;

await mkdir(artifactDir, { recursive: true });

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/api/leaderboard`);
      if (response.ok) return;
    } catch {
      // The local server may still be starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`game server did not become ready at ${baseUrl}`);
}

if (!process.env.GAME_URL) {
  server = spawn(process.execPath, ['tools/serve.mjs'], {
    cwd: root,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      LEADERBOARD_FILE: `${artifactDir}/leaderboard.json`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => process.stdout.write(`[server] ${chunk}`));
  server.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`http ${response.status()}: ${response.url()}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  await page.goto(`${baseUrl}/?harness=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__marbleHarness));

  await page.evaluate(() => document.getElementById('splash-screen')?.remove());
  await page.screenshot({ path: `${artifactDir}/menu.png`, fullPage: true });

  await page.evaluate(() => window.__marbleHarness.start());
  await page.waitForFunction(() => window.__marbleHarness.snapshot().grounded);
  const before = await page.evaluate(() => window.__marbleHarness.snapshot());
  const samples = [];
  await page.keyboard.down('ArrowLeft');
  for (let step = 0; step < 5; step++) {
    await page.waitForTimeout(200);
    samples.push(await page.evaluate(() => window.__marbleHarness.snapshot()));
  }
  await page.keyboard.up('ArrowLeft');
  const afterDrive = await page.evaluate(() => window.__marbleHarness.snapshot());

  await page.keyboard.down('Space');
  await page.waitForTimeout(500);
  await page.keyboard.up('Space');
  const afterBrake = await page.evaluate(() => window.__marbleHarness.snapshot());
  await page.screenshot({ path: `${artifactDir}/gameplay.png`, fullPage: true });
  await page.evaluate(() => window.__marbleHarness.showEndgame());
  await page.screenshot({ path: `${artifactDir}/endgame-menu.png`, fullPage: true });

  const distance = Math.hypot(afterDrive.x - before.x, afterDrive.z - before.z);
  const maxSpeed = Math.max(...samples.map((sample) => sample.speed));
  const result = {
    before,
    afterDrive,
    afterBrake,
    distanceAfterOneSecond: Number(distance.toFixed(4)),
    maxSpeed: Number(maxSpeed.toFixed(4)),
    consoleErrors: errors,
  };
  console.log(JSON.stringify(result, null, 2));

  if (errors.length > 0) throw new Error(`browser emitted ${errors.length} error(s)`);
  if (tuned) {
    if (afterDrive.dead) throw new Error('marble died during the one-second steering check');
    if (maxSpeed > 0.1) throw new Error(`marble exceeded tuned speed ceiling: ${maxSpeed}`);
    if (distance > 5) throw new Error(`marble travelled too far in one second: ${distance}`);
    if (afterBrake.speed >= afterDrive.speed * 0.45) {
      throw new Error(`brake did not reduce speed enough: ${afterDrive.speed} -> ${afterBrake.speed}`);
    }
  }
} finally {
  await browser?.close();
  if (server) {
    server.kill('SIGTERM');
    await new Promise((resolveWait) => server.once('exit', resolveWait));
  }
}
