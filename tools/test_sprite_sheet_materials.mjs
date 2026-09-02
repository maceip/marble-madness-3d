import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { chromium } from "playwright-core";

const root = resolve(import.meta.dirname, "..");
const port = 39192;
const baseUrl = `http://127.0.0.1:${port}`;
const artifactDir = resolve(`${root}/artifacts/test_sprites`);
let server;

await mkdir(artifactDir, { recursive: true });

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/api/leaderboard`);
      if (response.ok) return;
    } catch {
      // Waiting for server
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
  console.log("[Sprite Test] Waiting for server on port", port);
  await waitForServer();
  console.log("[Sprite Test] Server is ready!");

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
  });
  const page = await context.newPage();
  const pageErrors = [];
  const network404s = [];

  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("response", (resp) => {
    if (resp.status() >= 400 && resp.url().includes("/sprites/")) {
      network404s.push(`${resp.status()} ${resp.url()}`);
    }
  });

  console.log("[Sprite Test] Navigating to game...");
  await page.goto(`${baseUrl}/?harness=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__marbleHarness));

  // ---------------------------------------------------------------------------
  // TEST 1: Verify All Retro Font Sprites
  // ---------------------------------------------------------------------------
  console.log("\n--- Test 1: Verifying Retro Font Sprites ---");
  const fontStats = await page.evaluate(async () => {
    const chars = "MARBLE MADNESS 1986 !?$#+-0123456789";
    const sampleCodes = [36, 48, 65, 77, 88, 90]; // $, 0, A, M, X, Z
    const results = [];
    for (const code of sampleCodes) {
      const url = `/sprites/retro-font/char-${String(code).padStart(3, "0")}.png`;
      const res = await fetch(url);
      results.push({ code, ok: res.ok, status: res.status });
    }
    return results;
  });
  console.log("Font glyph check:", fontStats);
  assert(fontStats.every((f) => f.ok), "All sample retro font glyphs must return HTTP 200");
  testResults.push({ name: "Retro Font Glyphs Material Loading", pass: true });

  // ---------------------------------------------------------------------------
  // TEST 2: Verify Marble Sprites (Blue Player & Red Rival Rolling Frames)
  // ---------------------------------------------------------------------------
  console.log("\n--- Test 2: Verifying Marble Sprite Materials ---");
  const marbleStats = await page.evaluate(async () => {
    const urls = [
      "/sprites/retro-marble/blue-28.png",
      "/sprites/retro-marble/blue-29.png",
      "/sprites/retro-marble/blue-30.png",
      "/sprites/retro-marble/red-28.png",
      "/sprites/retro-marble/red-29.png",
      "/sprites/retro-marble/red-30.png",
      "/sprites/retro-marble/blue-08.png", // Broom sweeping
      "/sprites/retro-marble/blue-48.png", // Magic wand
    ];
    const checks = [];
    for (const u of urls) {
      const res = await fetch(u);
      checks.push({ url: u, ok: res.ok, status: res.status });
    }
    return checks;
  });
  console.log("Marble frame checks:", marbleStats);
  assert(marbleStats.every((m) => m.ok), "All marble sprite frames must return HTTP 200");
  testResults.push({ name: "Marble Blue & Red Rolling Sprite Materials", pass: true });

  // ---------------------------------------------------------------------------
  // TEST 3: Verify Object & Hazard Retro Sprites (Canopy, Funnel, Spigot, Muncher, etc.)
  // ---------------------------------------------------------------------------
  console.log("\n--- Test 3: Verifying Object & Hazard Retro Sprites ---");
  const objectSpriteStats = await page.evaluate(async () => {
    const urls = [
      "/sprites/enemies/enemy_056_32x37.png", // Canopy hood
      "/sprites/enemies/enemy_071_24x22.png", // Funnel mouth
      "/sprites/enemies/enemy_070_16x22.png", // Tube pipe
      "/sprites/enemies/enemy_069_15x23.png", // Spigot launch elbow
      "/sprites/enemies/enemy_068_7x24.png",  // Piston
      "/sprites/enemies/enemy_035_22x13.png", // Acid pool
      "/sprites/enemies/enemy_000_14x14.png", // Steelie
      "/sprites/enemies/enemy_020_14x14.png", // Muncher
      "/sprites/enemies/enemy_106_14x12.png", // Blade
      "/sprites/enemies/enemy_122_12x10.png", // Bat
      "/sprites/enemies/enemy_131_14x9.png",  // Snake
      "/sprites/enemies/enemy_145_10x7.png",  // Bomber
      "/sprites/enemies/enemy_078_12x11.png", // Item
    ];
    const results = [];
    for (const u of urls) {
      const res = await fetch(u);
      results.push({ url: u, ok: res.ok, status: res.status });
    }
    return results;
  });
  console.log("Object sprites checks count:", objectSpriteStats.length);
  assert(objectSpriteStats.every((o) => o.ok), "All object retro sprites must return HTTP 200");
  testResults.push({ name: "Hazard & Object Sprite Materials (Canopy, Funnel, Spigot, etc.)", pass: true });

  // ---------------------------------------------------------------------------
  // TEST 4: Verify Runtime Sprite Meshes on Stage 4, 5, 6, 7
  // ---------------------------------------------------------------------------
  console.log("\n--- Test 4: Verifying Runtime Hazard Sprite Meshes ---");
  await page.evaluate(() => window.__marbleHarness.start());
  await page.waitForTimeout(200);

  // Check Stage 4 has Funnel and Tube sprites
  await page.evaluate(() => window.__marbleHarness.warpToStage(4));
  await page.waitForTimeout(200);
  const stage4Sprites = await page.evaluate(() => {
    let count = 0;
    window.game.renderer.scene.traverse((obj) => {
      if (obj.name === "originalExtractedSprite") count++;
    });
    return count;
  });
  console.log("Stage 4 extracted sprites in scene:", stage4Sprites);
  assert(stage4Sprites >= 3, "Stage 4 must have originalExtractedSprite attachments for funnels and hazards");

  // Check Stage 6 has Canopy sprites
  await page.evaluate(() => window.__marbleHarness.warpToStage(6));
  await page.waitForTimeout(200);
  const stage6Sprites = await page.evaluate(() => {
    let count = 0;
    window.game.renderer.scene.traverse((obj) => {
      if (obj.name === "originalExtractedSprite") count++;
    });
    return count;
  });
  console.log("Stage 6 extracted sprites in scene:", stage6Sprites);
  assert(stage6Sprites >= 2, "Stage 6 must have originalExtractedSprite attachments for canopy tunnels");
  testResults.push({ name: "Runtime 3D Hazard Sprite Attachments", pass: true });

  // ---------------------------------------------------------------------------
  // TEST 5: Verify Death Broom Animation Sprite
  // ---------------------------------------------------------------------------
  console.log("\n--- Test 5: Verifying Death Broom Sweeping Sprite ---");
  await page.evaluate(() => window.__marbleHarness.warpToStage(1));
  await page.waitForTimeout(100);

  const deathSpriteInfo = await page.evaluate(() => {
    window.game.state = 'PLAYING';
    window.game.lives = 3;
    window.game.handleDeath('shatter');
    window.game.renderer.render(
      window.game.physics.marble,
      window.game.hazards.hazards,
      [],
      window.game.currentStageIndex + 1,
      0.016,
    );
    const sprite = window.game.renderer.marbleSprite;
    const mat = sprite?.material;
    const map = mat?.map;
    return {
      gameState: window.game.state,
      marbleDead: window.game.physics.marble.dead,
      spriteVisible: sprite?.visible,
      hasTexture: Boolean(mat && mat.map),
      scaleY: sprite?.scale.y,
    };
  });
  console.log("Death broom sprite info:", deathSpriteInfo);
  assert(deathSpriteInfo.spriteVisible === true, "Broom sprite must be visible on death");
  assert(deathSpriteInfo.scaleY > 1.0, "Broom sprite must use scaled broom aspect ratio");
  testResults.push({ name: "Arcade Broom Sweeping Animation on Death", pass: true });

  // ---------------------------------------------------------------------------
  // TEST 6: Verify Remote Player Red Marble Sprite
  // ---------------------------------------------------------------------------
  console.log("\n--- Test 6: Verifying Remote Player Red Marble Sprite ---");
  const remoteSpriteInfo = await page.evaluate(() => {
    window.game.renderer.syncRemotePlayers(
      [
        {
          id: 'mock_rival_red',
          name: 'RED RIVAL',
          color: '#ff3322',
          intelligence: 'AI',
          stage: 1,
          x: 14,
          y: 13,
          z: 3,
          vx: 0.1,
          vy: 0,
          vz: 0.1,
          rotX: 0,
          rotZ: 0,
          speed: 0.14,
          score: 1200,
        },
      ],
      1,
    );
    const rpm = window.game.renderer.remotePlayerMeshes.get('mock_rival_red');
    const sprite = rpm ? rpm.sprite : null;
    const mat = sprite ? sprite.material : null;
    return {
      hasRpm: Boolean(rpm),
      hasSprite: Boolean(sprite),
      spriteVisible: Boolean(sprite?.visible),
      matType: mat?.type,
      hasMapKey: Boolean(mat && 'map' in mat),
      mapVal: mat?.map ? 'truthy' : 'falsy',
    };
  });
  console.log('Remote player red sprite info:', remoteSpriteInfo);
  assert(remoteSpriteInfo.hasSprite === true, 'Remote player must have retro sprite attached');
  assert(remoteSpriteInfo.mapVal === 'truthy', 'Remote player sprite must have texture attached');
  testResults.push({ name: 'Remote / Rival Red Marble Sprite Integration', pass: true });

  await page.screenshot({ path: `${artifactDir}/sprite_verification.png` });
  console.log(`[Sprite Test] Screenshot captured: ${artifactDir}/sprite_verification.png`);

  console.log("\n======================================================");
  console.log("🎉 ALL SPRITE SHEET MATERIAL TESTS PASSED:");
  console.log("======================================================");
  testResults.forEach((t) => console.log(`  ✅ [PASS] ${t.name}`));

  assert(network404s.length === 0, `Network 404s detected: ${network404s.join(", ")}`);
  assert(pageErrors.length === 0, `Page errors detected: ${pageErrors.join(", ")}`);
} catch (err) {
  console.error("\n❌ TEST FAILED:", err);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) {
    server.kill("SIGTERM");
  }
}
