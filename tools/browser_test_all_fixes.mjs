import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright-core';

const root = resolve(import.meta.dirname, '..');
const port = 39188;
const baseUrl = `http://127.0.0.1:${port}`;
const artifactDir = resolve(`${root}/artifacts/test_fixes`);
let server;

await mkdir(artifactDir, { recursive: true });

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/api/leaderboard`);
      if (response.ok) return;
    } catch {
      // Waiting for server start
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Game server did not become ready at ${baseUrl}`);
}

server = spawn(process.execPath, ['tools/serve.mjs'], {
  cwd: root,
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    LEADERBOARD_FILE: `${artifactDir}/test_leaderboard.json`,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

server.stdout.on('data', (c) => process.stdout.write(`[server] ${c}`));
server.stderr.on('data', (c) => process.stderr.write(`[server] ${c}`));

let browser;
const testResults = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

try {
  console.log('[Test Harness] Waiting for server on port', port);
  await waitForServer();
  console.log('[Test Harness] Server is ready!');

  const defaultChrome =
    process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : '/snap/bin/chromium';

  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || defaultChrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader'],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    hasTouch: true,
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  console.log('[Test Harness] Navigating to game with harness mode...');
  await page.goto(`${baseUrl}/?harness=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__marbleHarness));

  // Start game directly
  await page.evaluate(() => window.__marbleHarness.start());
  await page.waitForTimeout(600);

  // ---------------------------------------------------------------------------
  // TEST 1: Batch Terrain Blocks using InstancedMesh (Perf Fix 1)
  // ---------------------------------------------------------------------------
  console.log('\n--- Running Test 1: InstancedMesh Terrain Batching ---');
  const perf1Stats = await page.evaluate(() => window.__marbleHarness.getStats());
  console.log('InstancedMesh count:', perf1Stats.instancedMeshCount);
  console.log('Total batched instances:', perf1Stats.instancedTotalInstances);
  assert(perf1Stats.instancedMeshCount > 0, 'Must have instanced mesh batches');
  assert(perf1Stats.instancedTotalInstances > 100, 'Must have batched over 100 terrain blocks into InstancedMesh');
  testResults.push({ name: 'Perf Fix 1: InstancedMesh Terrain Batching', pass: true });

  // ---------------------------------------------------------------------------
  // TEST 2: Prerender Static Minimap to Offscreen Canvas (Perf Fix 2)
  // ---------------------------------------------------------------------------
  console.log('\n--- Running Test 2: Prerender Static Minimap Terrain ---');
  const perf2Stats = await page.evaluate(() => window.__marbleHarness.getStats());
  console.log('Minimap has offscreen cache:', perf2Stats.hasMinimapOffscreenCache);
  console.log(`Minimap canvas size: ${perf2Stats.minimapCanvasWidth}x${perf2Stats.minimapCanvasHeight}`);
  assert(perf2Stats.hasMinimapOffscreenCache, 'Minimap must cache static background in offscreen canvas');
  assert(perf2Stats.minimapCanvasWidth === 120, 'Minimap width must match fixed 120px buffer');
  testResults.push({ name: 'Perf Fix 2: Offscreen Canvas Minimap Pre-rendering', pass: true });

  // ---------------------------------------------------------------------------
  // TEST 3: Object-Pool Particle Effects & Eliminate Leaks (Perf Fix 3)
  // ---------------------------------------------------------------------------
  console.log('\n--- Running Test 3: Particle Object Pooling ---');
  // Simulate rapid rolling to trigger skid and bump particles
  await page.evaluate(() => {
    window.game.physics.marble.speed = 0.18;
    window.game.physics.marble.grounded = true;
    for (let i = 0; i < 30; i++) {
      window.game.renderer.emitSkidMarks([5, 1, 5], 1.0);
      window.game.renderer.emitBumpSparks([5, 1, 5]);
    }
  });
  const perf3Stats = await page.evaluate(() => window.__marbleHarness.getStats());
  console.log('Particle pool size:', perf3Stats.particlePoolCount);
  console.log('Active particles count:', perf3Stats.activeParticles);
  assert(perf3Stats.particlePoolCount > 0, 'Particle pool must have preallocated or pooled particles');
  assert(perf3Stats.particlePoolCount <= 160, 'Particle pool must remain capped at MAX_PARTICLES (160)');
  testResults.push({ name: 'Perf Fix 3: Object-Pool Particle System', pass: true });

  // ---------------------------------------------------------------------------
  // TEST 4: Stage-Partitioned Networking & Compact Serialization (Perf Fix 4)
  // ---------------------------------------------------------------------------
  console.log('\n--- Running Test 4: Stage-Partitioned Networking ---');
  // Connect a 2nd client to the websocket server on stage 2
  const wsResult = await page.evaluate(async (port) => {
    return new Promise((resolveWs) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=test-stage2-token`);
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'welcome') {
          ws.send(
            JSON.stringify({
              type: 'update',
              stage: 2,
              x: 10,
              y: 1,
              z: 10,
              vx: 0,
              vy: 0,
              vz: 0,
              rotX: 0,
              rotZ: 0,
              speed: 0,
              score: 500,
            }),
          );
        }
        if (data.type === 'world_tick' && data.stage === 2) {
          ws.close();
          resolveWs({ receivedTick: true, tickStage: data.stage, count: data.count, players: data.players });
        }
      };
    });
  }, port);

  console.log('Server tick received on 2nd client:', wsResult);
  assert(wsResult.receivedTick === true, 'Client must receive world_tick');
  assert(typeof wsResult.count === 'number', 'Tick must contain global count');
  assert(wsResult.tickStage === 2, 'Tick must be partitioned for client stage');
  testResults.push({ name: 'Perf Fix 4: Stage-Partitioned Networking Broadcasts', pass: true });

  // ---------------------------------------------------------------------------
  // TEST 5: Dynamic Camera Occlusion Silhouette (UX Fix 5)
  // ---------------------------------------------------------------------------
  console.log('\n--- Running Test 5: Dynamic Camera Occlusion Silhouette ---');
  const ux5Stats = await page.evaluate(() => window.__marbleHarness.getStats());
  console.log('Marble silhouette mesh initialized:', ux5Stats.hasSilhouette);
  assert(ux5Stats.hasSilhouette, 'Local marble silhouette mesh must exist');
  testResults.push({ name: 'UX Fix 5: Dynamic Occlusion Silhouette Mesh', pass: true });

  // ---------------------------------------------------------------------------
  // TEST 6: Spatial Off-Screen Indicators & Radar Chevrons (UX Fix 6)
  // ---------------------------------------------------------------------------
  console.log('\n--- Running Test 6: Off-Screen Rival Radar Chevrons ---');
  // Connect a distant rival marble to the server on Stage 1
  await page.evaluate(async (port) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=test-stage1-rival`);
    await new Promise((resolveOpen) => {
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'welcome') {
          ws.send(
            JSON.stringify({
              type: 'update',
              stage: 1,
              name: 'CYBER-VIPER',
              color: '#ff0055',
              intelligence: 'AI',
              x: 35.0,
              y: 1.0,
              z: 40.0,
              vx: 0.1,
              vy: 0,
              vz: 0.1,
              rotX: 0,
              rotZ: 0,
              speed: 0.12,
              score: 1200,
            }),
          );
          resolveOpen();
        }
      };
    });
  }, port);

  // Wait for the browser client to receive tick and render the radar marker
  await page.waitForFunction(
    () => {
      const radar = document.getElementById('mp-radar');
      return Boolean(radar && radar.children.length >= 1);
    },
    { timeout: 4000 },
  );

  const ux6Stats = await page.evaluate(() => ({
    markersCount: window.__marbleHarness.getStats().radarMarkersCount,
    radarHtml: document.getElementById('mp-radar')?.innerHTML,
  }));
  console.log('Radar markers count:', ux6Stats.markersCount);
  console.log('Full Radar HTML:', ux6Stats.radarHtml);
  assert(ux6Stats.markersCount >= 1, 'Must render at least one off-screen radar chevron');
  assert(ux6Stats.radarHtml.includes('radar-chevron'), 'Marker must contain radar-chevron');
  assert(ux6Stats.radarHtml.includes('radar-tag'), 'Marker must contain rival radar-tag');
  assert(ux6Stats.radarHtml.includes('m</span>'), 'Marker must display distance in meters');
  testResults.push({ name: 'UX Fix 6: Spatial Off-Screen Indicators & Radar Chevrons', pass: true });

  // ---------------------------------------------------------------------------
  // TEST 7: Ergonomic Mobile Controls: Floating Dynamic Joystick & Quick-Zero Tilt (UX Fix 7)
  // ---------------------------------------------------------------------------
  console.log('\n--- Running Test 7: Mobile Controls (Floating Joystick & Zero Tilt) ---');
  // Test Quick-Zero Tilt button
  await page.evaluate(() => window.__marbleHarness.triggerZeroTilt());
  await page.waitForTimeout(150);
  const bannerText = await page.evaluate(() => document.getElementById('banner')?.textContent);
  console.log('Banner on zero-tilt click:', bannerText);
  assert(bannerText?.includes('TILT RE-CENTERED'), 'Zero-tilt button must trigger re-centering feedback');

  // Test Floating Joystick positioning on touch
  const joyStyleBefore = await page.evaluate(() => document.getElementById('joy')?.style.left);
  await page.touchscreen.tap(150, 400);
  await page.waitForTimeout(150);
  const joyStyleAfter = await page.evaluate(() => document.getElementById('joy')?.style.left);
  console.log(`Joystick left before: ${joyStyleBefore}, after touch: ${joyStyleAfter}`);
  assert(joyStyleAfter === '150px', 'Floating joystick must snap to touch coordinates on left half of screen');
  testResults.push({ name: 'UX Fix 7: Floating Dynamic Joystick & Quick-Zero Tilt', pass: true });

  // ---------------------------------------------------------------------------
  // TEST 8: Seamless Multiplayer Spectator Mode on Game Over (UX Fix 8)
  // ---------------------------------------------------------------------------
  console.log('\n--- Running Test 8: Multiplayer Spectator Mode on Game Over ---');
  // Trigger game over
  await page.evaluate(() => window.__marbleHarness.triggerDeath());
  await page.waitForTimeout(300);

  const ux8Stats = await page.evaluate(() => ({
    snapshot: window.__marbleHarness.snapshot(),
    stats: window.__marbleHarness.getStats(),
  }));
  console.log('Spectating state:', ux8Stats.snapshot.spectating);
  console.log('Spectator overlay visible:', ux8Stats.stats.spectatorOverlayVisible);
  console.log('Spectator target text:', ux8Stats.stats.spectatorTargetText);

  assert(ux8Stats.snapshot.spectating === true, 'GameManager must transition to SPECTATING state');
  assert(ux8Stats.stats.spectatorOverlayVisible === true, 'Spectator overlay UI must be displayed');

  // Test cycling spectator targets
  await page.evaluate(() => window.__marbleHarness.cycleSpectator(1));
  await page.waitForTimeout(100);

  // Test respawn button from spectator overlay
  await page.evaluate(() => window.__marbleHarness.respawnFromSpectator());
  await page.waitForTimeout(200);

  const afterRespawn = await page.evaluate(() => ({
    snapshot: window.__marbleHarness.snapshot(),
    stats: window.__marbleHarness.getStats(),
  }));
  console.log('State after respawn:', afterRespawn.snapshot.state);
  console.log('Lives after respawn:', afterRespawn.snapshot.lives);
  console.log('Spectator overlay visible after respawn:', afterRespawn.stats.spectatorOverlayVisible);

  assert(afterRespawn.snapshot.state === 'PLAYING', 'Game must transition back to PLAYING after respawn');
  assert(afterRespawn.snapshot.lives === 3, 'Lives must reset to 3');
  assert(afterRespawn.stats.spectatorOverlayVisible === false, 'Spectator overlay must hide after respawn');
  testResults.push({ name: 'UX Fix 8: Seamless Multiplayer Spectator Mode & Instant Respawn', pass: true });

  // Save screenshot of verified game
  await page.screenshot({ path: `${artifactDir}/all_fixes_verified.png` });

  console.log('\n======================================================');
  console.log('🎉 ALL 8 FIXES VERIFIED SUCCESSFULLY IN BROWSER HARNESS:');
  console.log('======================================================');
  for (const r of testResults) {
    console.log(`  ✅ [PASS] ${r.name}`);
  }
} catch (err) {
  console.error('\n❌ TEST FAILED:', err);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) {
    server.kill('SIGTERM');
  }
}
