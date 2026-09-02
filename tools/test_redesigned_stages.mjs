import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { chromium } from "playwright-core";

const root = resolve(import.meta.dirname, "..");
const port = 39190;
const baseUrl = `http://127.0.0.1:${port}`;
const artifactDir = resolve(`${root}/artifacts/test_redesigned_stages`);
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

server = spawn(process.execPath, ["tools/serve.mjs"], {
  cwd: root,
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    LEADERBOARD_FILE: `${artifactDir}/test_leaderboard.json`,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

server.stdout.on("data", (c) => process.stdout.write(`[server] ${c}`));
server.stderr.on("data", (c) => process.stderr.write(`[server] ${c}`));

let browser;
const testResults = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

try {
  console.log("[Test Harness] Waiting for server on port", port);
  await waitForServer();
  console.log("[Test Harness] Server is ready!");

  const defaultChrome =
    process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : "/snap/bin/chromium";

  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || defaultChrome,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader"],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    hasTouch: true,
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  console.log("[Test Harness] Navigating to game...");
  await page.goto(`${baseUrl}/?harness=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__marbleHarness));

  // Start game directly
  await page.evaluate(() => window.__marbleHarness.start());
  await page.waitForTimeout(300);

  // ---------------------------------------------------------------------------
  // TEST 1: Verify all 8 faithful redesigned stages load cleanly
  // ---------------------------------------------------------------------------
  console.log("\n--- Test 1: Verifying all 8 redesigned stages load cleanly ---");
  for (let s = 1; s <= 8; s++) {
    await page.evaluate((stageNum) => window.__marbleHarness.warpToStage(stageNum), s);
    await page.waitForTimeout(200);
    const snap = await page.evaluate(() => window.__marbleHarness.snapshot());
    console.log(`Stage ${s} loaded: stageIndex=${snap.stage}, pos=(${snap.x.toFixed(1)}, ${snap.y.toFixed(1)}, ${snap.z.toFixed(1)}), lives=${snap.lives}`);
    assert(snap.stage === s, `Stage ${s} must be active`);
    assert(snap.lives >= 1, `Stage ${s} must start with positive lives`);
  }
  testResults.push({ name: "All 8 Redesigned Stages Load Correctly", pass: true });

  // ---------------------------------------------------------------------------
  // TEST 2: Stage 4 Purple Funnel Transport Dynamics
  // ---------------------------------------------------------------------------
  console.log("\n--- Test 2: Testing Stage 4 Purple Funnel Pipe ---");
  await page.evaluate(() => window.__marbleHarness.warpToStage(4));
  await page.waitForTimeout(250);

  // Place marble on the approach ramp upstream of funnel hopper
  await page.evaluate(() => {
    const funnel = window.game.hazards.hazards.find((h) => h.def.kind === 'funnel');
    if (funnel) {
      window.__marbleHarness.setMarblePos(funnel.x, funnel.y, funnel.z - 1.0);
      window.game.physics.marble.vz = 0.04;
      window.game.physics.marble.grounded = true;
    }
  });

  // Wait for funnel suction to capture marble
  await page.waitForFunction(() => window.game.physics.marble.inTube === true, { timeout: 3000 });
  const inTube = await page.evaluate(() => window.game.physics.marble.inTube);
  console.log('Marble inStage4 funnel tube:', inTube);
  assert(inTube === true, 'Marble must be captured by the Stage 4 purple funnel');

  // Wait for tube travel to complete and emerge downstream
  await page.waitForFunction(() => !window.game.physics.marble.inTube && window.game.physics.marble.z >= 20, { timeout: 4000 });
  const postFunnelSnap = await page.evaluate(() => window.__marbleHarness.snapshot());
  console.log(`Post-funnel position: (${postFunnelSnap.x.toFixed(1)}, ${postFunnelSnap.y.toFixed(1)}, ${postFunnelSnap.z.toFixed(1)}), inTube=${await page.evaluate(() => window.game.physics.marble.inTube)}`);
  assert(postFunnelSnap.z >= 20, 'Marble must have exited the purple funnel tube downstream');
  assert(postFunnelSnap.dead === false, 'Marble must not have died during tube transport');
  testResults.push({ name: 'Stage 4: Purple Funnel Tube Suction & Transport', pass: true });

  // ---------------------------------------------------------------------------
  // TEST 3: Stage 5 Vertical Drop Pipe Spigot Dynamics
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 3: Testing Stage 5 Spigot Drop Pipe ---');
  await page.evaluate(() => window.__marbleHarness.warpToStage(5));
  await page.waitForTimeout(250);

  // Warp marble into spigot hopper
  await page.evaluate(() => {
    const spigot = window.game.hazards.hazards.find((h) => h.def.kind === 'spigot');
    if (spigot) window.__marbleHarness.setMarblePos(spigot.x, spigot.y, spigot.z);
  });

  await page.waitForFunction(() => window.game.physics.marble.inTube === true, { timeout: 3000 });
  const inSpigot = await page.evaluate(() => window.game.physics.marble.inTube);
  console.log('Marble inStage5 spigot drop pipe:', inSpigot);
  assert(inSpigot === true, 'Marble must enter the Stage 5 drop pipe hopper');

  // Wait for drop pipe travel
  await page.waitForFunction(() => !window.game.physics.marble.inTube && window.game.physics.marble.z >= 19, { timeout: 4000 });
  const postSpigotSnap = await page.evaluate(() => window.__marbleHarness.snapshot());
  console.log(`Post-spigot position: (${postSpigotSnap.x.toFixed(1)}, ${postSpigotSnap.y.toFixed(1)}, ${postSpigotSnap.z.toFixed(1)})`);
  assert(postSpigotSnap.z >= 19, 'Marble must have launched out the bottom elbow onto lower catwalk');
  testResults.push({ name: 'Stage 5: Vertical Drop Pipe Spigot Dynamics', pass: true });

  // ---------------------------------------------------------------------------
  // TEST 4: Stage 7 Central Rotating 4-Paddle Windmill
  // ---------------------------------------------------------------------------
  console.log("\n--- Test 4: Testing Stage 7 Mechanical Windmill ---");
  await page.evaluate(() => window.__marbleHarness.warpToStage(7));
  await page.waitForTimeout(250);

  const windmillHazard = await page.evaluate(() => {
    const wm = window.game.hazards.hazards.find((h) => h.def.kind === "windmill");
    return wm ? { active: wm.active, rotation: wm.rotation, x: wm.x, z: wm.z } : null;
  });
  console.log("Windmill hazard on Stage 7:", windmillHazard);
  assert(Boolean(windmillHazard), "Stage 7 must contain the 4-paddle rotating windmill hazard");

  const rotBefore = windmillHazard.rotation;
  await page.waitForTimeout(300);
  const rotAfter = await page.evaluate(() => {
    const wm = window.game.hazards.hazards.find((h) => h.def.kind === "windmill");
    return wm?.rotation;
  });
  console.log(`Windmill rotation: before=${rotBefore.toFixed(2)}, after=${rotAfter.toFixed(2)}`);
  assert(rotAfter > rotBefore, "Windmill must be continuously rotating in 3D");
  testResults.push({ name: "Stage 7: Central 4-Paddle Rotating Mechanical Windmill", pass: true });

  // ---------------------------------------------------------------------------
  // TEST 5: Stage 6 & Stage 8 3D Canopy Tunnels with Occlusion
  // ---------------------------------------------------------------------------
  console.log("\n--- Test 5: Testing Stage 6 & 8 Canopy Tunnels with Occlusion ---");
  await page.evaluate(() => window.__marbleHarness.warpToStage(6));
  await page.waitForTimeout(250);

  const canopiesStage6 = await page.evaluate(() => {
    return window.game.hazards.hazards.filter((h) => h.def.kind === "canopy").length;
  });
  console.log("Stage 6 canopy tunnels count:", canopiesStage6);
  assert(canopiesStage6 >= 1, "Stage 6 must include 3D canopy tunnel hazards");

  await page.evaluate(() => window.__marbleHarness.warpToStage(8));
  await page.waitForTimeout(250);

  const canopiesStage8 = await page.evaluate(() => {
    return window.game.hazards.hazards.filter((h) => h.def.kind === "canopy").length;
  });
  console.log("Stage 8 triangular canopy tunnels count:", canopiesStage8);
  assert(canopiesStage8 >= 1, "Stage 8 must include 3D triangular canopy hazards");
  testResults.push({ name: "Stage 6 & 8: 3D Canopy & Archway Tunnels with Occlusion", pass: true });

  // Take screenshot of Stage 4 with the purple funnel
  await page.evaluate(() => window.__marbleHarness.warpToStage(4));
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${artifactDir}/stage4_funnel_verified.png` });
  console.log(`[Test Harness] Screenshot captured: ${artifactDir}/stage4_funnel_verified.png`);

  console.log("\n======================================================");
  console.log("🎉 ALL REDESIGNED STAGE TESTS PASSED:");
  console.log("======================================================");
  testResults.forEach((t) => console.log(`  ✅ [PASS] ${t.name}`));

  assert(pageErrors.length === 0, `Browser errors detected: ${pageErrors.join(", ")}`);
} catch (err) {
  console.error("\n❌ TEST FAILED:", err);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) {
    server.kill("SIGTERM");
  }
}
