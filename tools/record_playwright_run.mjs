// Playwright script: launches browser with video recording, drives marble using window.mmDebug,
// records full movement, and saves video to artifacts/recordings/.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execSync, spawn } from 'node:child_process';

const stage = parseInt(process.argv[2] || '1', 10);
const recDir = path.resolve('artifacts/recordings');
fs.mkdirSync(recDir, { recursive: true });

console.log(`Starting Playwright run for Stage ${stage} with video recording...`);
const browser = await chromium.launch({
  channel: 'chrome',
  headless: process.env.HEADLESS !== '0',
});

const context = await browser.newContext({
  viewport: { width: 640, height: 800 },
  recordVideo: { dir: recDir, size: { width: 640, height: 800 } },
});

const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

// Target: production (synced with main) unless BASE / PORT say otherwise.
//   node tools/record_playwright_run.mjs 1                      -> https://marbles.secure.build
//   BASE=http://127.0.0.1:3200 node tools/record_playwright_run.mjs 1
//   PORT=3200 node tools/record_playwright_run.mjs 1            -> local server (started if needed)
let BASE = process.env.BASE || (process.env.PORT ? `http://127.0.0.1:${process.env.PORT}` : 'https://marbles.secure.build');
if (!process.env.BASE && process.env.PORT) {
  const port = process.env.PORT;
  const checkServer = () => new Promise((resolve) => {
    http.get(`http://127.0.0.1:${port}/`, (res) => resolve(res.statusCode < 500)).on('error', () => resolve(false));
  });
  if (!(await checkServer())) {
    console.log(`Starting server on port ${port}...`);
    const srv = spawn('node', ['tools/serve.mjs'], { stdio: 'ignore', detached: true, env: { ...process.env, PORT: port } });
    srv.unref();
    await new Promise((r) => setTimeout(r, 1500));
  }
}
console.log(`Target: ${BASE}`);
const traceFile = path.join(recDir, `stage_${stage}_trace.jsonl`);
fs.writeFileSync(traceFile, '');
const physTrace = [];
const counts = {};
// pull the engine's physics trace (mmDebug.trace) and print everything that is not a routine sample
const drainTrace = async (label = '') => {
  const evs = await page.evaluate(() => (window.mmDebug && window.mmDebug.trace) ? window.mmDebug.trace() : []);
  for (const e of evs) {
    counts[e.ev] = (counts[e.ev] || 0) + 1;
    physTrace.push(e);
    fs.appendFileSync(traceFile, JSON.stringify(e) + '\n');
    if (e.ev !== 'sample') console.log(`  [phys ${e.t.toFixed(2)}] ${e.ev.toUpperCase().padEnd(8)} px(${e.sx},${e.sy}) z${e.z} v(${e.vu},${e.vv}) ${e.g ? 'ground' : 'AIR'} on ${e.sup} in(${e.in})${e.why ? '  <- ' + e.why : ''}${label}`);
  }
  return evs;
};
const dumpGrid = async (reason) => {
  const [grid, probe, status] = await page.evaluate(() => [window.mmDebug.around(6, 2), window.mmDebug.probe(), window.mmDebug.status()]);
  console.log(`\n=== ${reason} ===\n${status}\nprobe: ${JSON.stringify(probe)}\n${grid}\n`);
};

await page.goto(`${BASE}/?stage=${stage}`, { waitUntil: 'load' });

// Wait for race screen
await page.waitForFunction(() => window.game && window.game.screen === 'race', null, { timeout: 25000 });
console.log('Game reached race screen.');
await page.waitForTimeout(1000);

// Waypoints for navigation per stage
const WAYPOINTS = {
  1: [
    { name: 'top_spawn', sx: 145, sy: 25 },
    { name: 'hills_left', sx: 95, sy: 95 },           // pass the tent block on its left
    { name: 'plateau_left', sx: 75, sy: 200 },
    { name: 'plateau', sx: 165, sy: 250 },            // right of the arrow post
    { name: 'chute_mouth', sx: 152, sy: 300 },
    { name: 'chute_gate', sx: 143, sy: 336, r: 10 },       // left of the red rail's end post (157,342)
    { name: 'chute_upper', sx: 162, sy: 362, r: 10, speed: 50 },
    { name: 'chute_arm', sx: 171, sy: 380, r: 10, speed: 45 },
    { name: 'chute_bend', sx: 140, sy: 392, r: 10, speed: 45 },
    { name: 'chute_elbow', sx: 120, sy: 399, r: 10, speed: 45 },
    { name: 'chute_neck', sx: 129, sy: 412, r: 8, speed: 45 },
    { name: 'chute_lower', sx: 145, sy: 432, r: 10, speed: 50 },
    { name: 'chute_exit', sx: 172, sy: 452, r: 10, speed: 40, brake: 2.5 },
    { name: 'ledge', sx: 166, sy: 470, r: 8, speed: 35, brake: 2.5 },
    { name: 'corridor_entry', sx: 158, sy: 503, r: 12, speed: 45 },   // drop off the pipe's front lip
    { name: 'corridor_mid', sx: 110, sy: 505 },
    { name: 'goal', sx: 45, sy: 535 },
  ],
  2: [
    { name: 'plateau_start', sx: 105, sy: 80 },
    { name: 'center_corridor1', sx: 130, sy: 110 },
    { name: 'center_corridor2', sx: 130, sy: 140 },
    { name: 'center_corridor3', sx: 140, sy: 175 },
    { name: 'rampA_approach', sx: 180, sy: 185 },
    { name: 'rampA_entry', sx: 215, sy: 190 },
    { name: 'rampA_1', sx: 175, sy: 230 },
    { name: 'rampA_2', sx: 135, sy: 275 },
    { name: 'rampA_3', sx: 95, sy: 320 },
    { name: 'rampA_exit', sx: 55, sy: 365 },
    { name: 'cones_floor_entry', sx: 100, sy: 420 },
    { name: 'cones_floor_mid', sx: 140, sy: 460 },
    { name: 'stairs_approach', sx: 170, sy: 520 },
    { name: 'stairs_top', sx: 170, sy: 545 },
    { name: 'funnel_approach', sx: 235, sy: 580 },
    { name: 'funnel_pipe', sx: 245, sy: 612 },
    { name: 'pipe_exit_run', sx: 185, sy: 750 },
    { name: 'y_pipe_inlet', sx: 178, sy: 786 },
    { name: 'teal_plaza', sx: 236, sy: 892 },
    { name: 'ice_slope_top', sx: 232, sy: 950 },
    { name: 'ice_slope_down', sx: 160, sy: 1020 },
    { name: 'goal_sign', sx: 184, sy: 1108 },
  ],
  3: [
    { name: 'tower_slide', sx: 45, sy: 52 },
    { name: 'maze_landing', sx: 94, sy: 150 },
    { name: 'maze_turn1', sx: 110, sy: 250 },
    { name: 'maze_turn2', sx: 80, sy: 360 },
    { name: 'maze_turn3', sx: 110, sy: 480 },
    { name: 'maze_turn4', sx: 150, sy: 560 },
    { name: 'funnel_pipe', sx: 162, sy: 645 },
    { name: 'pipe_exit', sx: 152, sy: 768 },
    { name: 'wave_plate', sx: 120, sy: 880 },
    { name: 'wave_run', sx: 160, sy: 980 },
    { name: 'goal_sign', sx: 232, sy: 1036 },
  ],
  4: [
    { name: 'tower_slide', sx: 250, sy: 55 },
    { name: 'slide_landing', sx: 60, sy: 220 },
    { name: 'green_path_top', sx: 100, sy: 300 },
    { name: 'zigzag1', sx: 140, sy: 380 },
    { name: 'zigzag2', sx: 100, sy: 460 },
    { name: 'zigzag3', sx: 160, sy: 540 },
    { name: 'slide_lower', sx: 100, sy: 700 },
    { name: 'lower_floor', sx: 140, sy: 850 },
    { name: 'goal_sign', sx: 88, sy: 972 },
  ],
  5: [
    { name: 'bottom_start', sx: 146, sy: 1060 },
    { name: 'x_ramp_climb', sx: 146, sy: 920 },
    { name: 'plaza_entry', sx: 120, sy: 845 },
    { name: 'plaza_mid', sx: 150, sy: 780 },
    { name: 'green_climb1', sx: 60, sy: 650 },
    { name: 'green_climb2', sx: 110, sy: 578 },
    { name: 'orange_climb', sx: 60, sy: 440 },
    { name: 'red_climb', sx: 270, sy: 280 },
    { name: 'summit_path', sx: 150, sy: 104 },
    { name: 'summit_goal', sx: 150, sy: 62 },
  ],
  6: [
    { name: 'start_top', sx: 120, sy: 96 },
    { name: 'glass_bridge', sx: 80, sy: 250 },
    { name: 'island_mid', sx: 150, sy: 300 },
    { name: 'lower_drop', sx: 150, sy: 480 },
    { name: 'arena_floor', sx: 150, sy: 600 },
    { name: 'shifting_goal', sx: 156, sy: 706 },
  ],
};

const wps = WAYPOINTS[stage] || WAYPOINTS[1];
let wpIdx = 1; // start moving to first target
let reachedGoal = false;
let lastDeaths = 0;
const trace = [];
let stallTicks = 0;
let lastPos = null;

console.log(`Navigating through ${wps.length} waypoints using mmDebug...`);

for (let tick = 0; tick < 400 && !reachedGoal; tick++) {
  const m = await page.evaluate(() => {
    const d = window.mmDebug ? window.mmDebug.marble() : null;
    return d;
  });

  if (!m) {
    console.log('No mmDebug info');
    await page.waitForTimeout(200);
    continue;
  }

  trace.push({ tick, ...m });
  if (tick % 5 === 0) {
    console.log(`[tick ${tick}] sx=${m.sx}, sy=${m.sy}, z=${m.z}, g=${m.grounded}, phase=${m.phase}, sup=${m.sup}`);
  }
  const evs = await drainTrace();
  if (evs.some((e) => e.ev === 'stall' || e.ev === 'die')) {
    await dumpGrid(evs.find((e) => e.ev === 'stall' || e.ev === 'die').ev);
    if (evs.some((e) => e.ev === 'stall')) stallTicks = 0;
  }
  // give up on a spot the marble cannot leave (the grid dump above says why)
  if (m.phase === 'alive' && lastPos && Math.abs(lastPos.sx - m.sx) < 2 && Math.abs(lastPos.sy - m.sy) < 2) {
    if (++stallTicks >= 40) { console.log(`Marble has not moved for ${stallTicks} ticks at (${m.sx},${m.sy}); stopping.`); await dumpGrid('STUCK'); break; }
  } else stallTicks = 0;
  lastPos = { sx: m.sx, sy: m.sy };

  if (m.screen === 'timebonus' || m.screen === 'congrats' || m.goal) {
    console.log(`🏆 Goal reached at tick ${tick}! (Screen: ${m.screen}, Deaths: ${m.deaths})`);
    reachedGoal = true;
    break;
  }

  if (m.phase !== 'alive') {
    console.log(`Marble not alive (${m.phase}), waiting for respawn...`);
    await page.waitForTimeout(500);
    continue;
  }

  if (lastDeaths === undefined) lastDeaths = m.deaths;
  if (m.deaths !== lastDeaths) {
    lastDeaths = m.deaths;
    let bestIdx = 1, bestDist = Infinity;
    for (let i = 1; i < wps.length; i++) {
      const d = Math.hypot(wps[i].sx - m.sx, wps[i].sy - m.sy);
      if (d < bestDist && wps[i].sy >= m.sy - 20) {
        bestDist = d;
        bestIdx = i;
      }
    }
    wpIdx = bestIdx;
    console.log(`Marble respawned at (${m.sx}, ${m.sy}), reset target to #${wpIdx} (${wps[wpIdx].name})`);
  }

  const target = wps[wpIdx];
  const dx = target.sx - m.sx;
  const dy = target.sy - m.sy;
  const dist = Math.hypot(dx, dy);

  // advance when within reach, or when the marble has already passed it (closer to the next one than the
  // waypoint itself is) so a fast section cannot make it turn around and push back up the course
  while (wpIdx < wps.length - 1) {
    const t = wps[wpIdx], n = wps[wpIdx + 1];
    const dT = Math.hypot(t.sx - m.sx, t.sy - m.sy), dN = Math.hypot(n.sx - m.sx, n.sy - m.sy), seg = Math.hypot(n.sx - t.sx, n.sy - t.sy);
    if (dT < (t.r ?? 18) || (dN < seg * 0.5 && dT < seg)) {
      console.log(`✓ Reached waypoint #${wpIdx} (${t.name}) at (${m.sx}, ${m.sy}). Next: ${n.name}`);
      wpIdx++;
    } else break;
  }

  // Calculate normalized steering direction
  const currTarget = wps[wpIdx];
  let tdx = currTarget.sx - m.sx;
  let tdy = currTarget.sy - m.sy;
  
  const tdist = Math.hypot(tdx, tdy) || 1;
  const nx = tdx / tdist;
  const ny = tdy / tdist;
  // Trackball model is heavy (impulse + bearing friction), so pulse it every tick. Ease off near a waypoint
  // and when the marble is already fast, so it can take the corners instead of flying off.
  const sp = Math.hypot(m.vu ?? 0, m.vv ?? 0);
  let speed = currTarget.speed ?? (tdist < 30 ? 55 : 80);
  if (sp > 6) speed = Math.min(speed, 40);
  if (stage === 2 && m.sy > 180 && m.sy < 370) speed = Math.min(speed, 40);

  // Apply trackball spin via mmDebug. Waypoints with `brake` counter-spin while the marble is faster than
  // that many tiles/s (there are no brakes on the cabinet: reverse the ball).
  let cmd = [nx, ny, speed];
  if (currTarget.brake && sp > currTarget.brake) {
    const vsx = (m.vu - m.vv), vsy = (m.vu + m.vv) / 2, vl = Math.hypot(vsx, vsy) || 1;   // velocity in screen space
    cmd = [-vsx / vl, -vsy / vl, 70];
  }
  await page.evaluate(([nx, ny, speed]) => {
    window.mmDebug.spin(nx, ny, speed);
  }, cmd);

  await page.waitForTimeout(150);
}

// Keep recording for 2 more seconds to see the celebration / bonus
await page.waitForTimeout(2000);
await drainTrace();

// Close context to finalize video recording
const video = page.video();
const videoPath = video ? await video.path() : null;
await context.close();
await browser.close();

console.log(`Video recorded to: ${videoPath}`);

// Convert to mp4 for universal viewing
if (videoPath && fs.existsSync(videoPath)) {
  const mp4Path = path.join(recDir, `stage_${stage}_run.mp4`);
  try {
    execSync(`ffmpeg -y -i "${videoPath}" -pix_fmt yuv420p "${mp4Path}"`, { stdio: 'ignore' });
    console.log(`Converted to MP4: ${mp4Path}`);
  } catch (e) {
    console.log('ffmpeg convert error:', e.message);
  }
}

// Summary of the run
const finalState = trace[trace.length - 1];
console.log('\n--- RUN SUMMARY ---');
console.log(`Stage: ${stage}`);
console.log(`Goal reached: ${reachedGoal ? 'YES ✅' : 'NO ❌'}`);
console.log(`Final deaths: ${finalState ? finalState.deaths : '?'}`);
console.log(`Final surface: ${finalState ? finalState.sup : '?'}`);
console.log(`Waypoints hit: ${wpIdx} / ${wps.length - 1}`);
console.log(`Physics events: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ') || 'none (bundle without mmDebug.trace?)'}`);
console.log(`Trace: ${traceFile}`);
if (errors.length) console.log('Page errors:', errors);
