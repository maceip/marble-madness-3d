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

// first-run overlays (desktop trackball tutorial) pause the intro until dismissed: mark them seen
await context.addInitScript(() => { try { localStorage.setItem('mm_desktop_trackball_tutorial_v1', '1'); } catch {} });
await page.goto(`${BASE}/?stage=${stage}`, { waitUntil: 'load' });

// Wait for race screen
await page.waitForFunction(() => window.game && window.game.screen === 'race', null, { timeout: 25000 });
console.log('Game reached race screen.');
const controlsReversed = await page.evaluate(() => !!(window.game && window.game.stage && window.game.stage.reverseControls));
if (controlsReversed) console.log('Stage has reversed controls: trackball spins will be pre-inverted.');
await page.evaluate(() => window.mmDebug.hazards && window.mmDebug.hazards(false));
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
    // drop off the pipe's front lip onto a diagonal corridor ~14 px wide: wall (pipe block) on its upper side, void on its lower side.
    // Centreline runs (160,508) -> (146,516) -> (126,524); land slow and follow it.
    { name: 'corridor_entry', sx: 160, sy: 508, r: 10, speed: 35, brake: 2 },
    { name: 'corridor_in', sx: 146, sy: 516, r: 8, speed: 35, brake: 2.5 },
    { name: 'corridor_mid', sx: 116, sy: 522, r: 10 },
    { name: 'goal', sx: 45, sy: 535 },
  ],
  2: [
    // plateau: thread between the raised blocks to the white ramp's head
    { name: 'plateau_start', sx: 105, sy: 80 },
    { name: 'p1', sx: 116, sy: 100 },
    { name: 'p2', sx: 133, sy: 114 },
    { name: 'p3', sx: 155, sy: 114 },
    { name: 'p4', sx: 177, sy: 114 },
    { name: 'p5', sx: 199, sy: 119 },
    { name: 'p6', sx: 215, sy: 135 },
    { name: 'p7', sx: 220, sy: 157 },
    { name: 'p8', sx: 220, sy: 179 },
    { name: 'ramp_head', sx: 228, sy: 190, r: 10 },
    // white ramp 240 -> 150 (steep: brake so the tent floor is not overshot)
    { name: 'r1', sx: 213, sy: 208, r: 10, speed: 40 },
    { name: 'r2', sx: 201, sy: 227, r: 10, speed: 40 },
    { name: 'r3', sx: 189, sy: 247, r: 10, speed: 40 },
    { name: 'r4', sx: 179, sy: 262, r: 10, speed: 40 },
    { name: 'r5', sx: 158, sy: 271, r: 10, speed: 40 },
    { name: 'r6', sx: 136, sy: 278, r: 10, speed: 40 },
    { name: 'r7', sx: 116, sy: 289, r: 10, speed: 40, brake: 2 },
    { name: 'r8', sx: 104, sy: 309, r: 10, speed: 40, brake: 2 },
    { name: 'r9', sx: 90, sy: 330, r: 10, speed: 40, brake: 2 },
    { name: 'r10', sx: 69, sy: 337, r: 10, speed: 40, brake: 2 },
    { name: 'r11', sx: 56, sy: 357, r: 10, speed: 40, brake: 2 },
    // tent floor 150, then roll off the 32 px ledge onto the mid floor 118
    { name: 'tent1', sx: 94, sy: 388 },
    { name: 'tent2', sx: 119, sy: 426 },
    { name: 'tent3', sx: 128, sy: 462, r: 10, speed: 40, brake: 3 },
    { name: 'ledge', sx: 140, sy: 482, r: 10, speed: 35, brake: 3 },              // between the pillars on the mid floor
    { name: 'mid1', sx: 150, sy: 530, r: 12, speed: 35, brake: 3 },
    { name: 'mid2', sx: 190, sy: 560, r: 10, speed: 40, brake: 3 },
    { name: 'mid3', sx: 215, sy: 582, r: 10, speed: 35, brake: 3 },
    { name: 'funnel', sx: 235, sy: 600, r: 6, speed: 35 },
    // funnel pipe -> catwalk landing -> long diagonal -> Y pipe inlet
    { name: 'catwalk_landing', sx: 212, sy: 722, r: 10, speed: 40 },
    { name: 'cw1', sx: 180, sy: 745, r: 8, speed: 40 },
    { name: 'cw2', sx: 140, sy: 752, r: 8, speed: 40 },
    { name: 'cw3', sx: 100, sy: 760, r: 8, speed: 40 },
    { name: 'cw4', sx: 108, sy: 766, r: 6, speed: 35 },
    { name: 'cw5', sx: 118, sy: 772, r: 6, speed: 35 },
    { name: 'cw6', sx: 128, sy: 778, r: 6, speed: 35 },
    { name: 'y_platform', sx: 147, sy: 782, r: 6, speed: 35 },
    { name: 'y_inlet', sx: 156, sy: 790, r: 6, speed: 35 },
    // Y pipe -> lower floor 70 -> across the teal -> drop onto the goal floor 40
    { name: 'pipe_out', sx: 250, sy: 905, r: 10 },
    { name: 't1', sx: 236, sy: 945 },
    { name: 't2', sx: 204, sy: 977 },
    { name: 't3', sx: 172, sy: 1009 },
    { name: 'grey_step', sx: 112, sy: 1030, r: 10, speed: 35 },   // ~20 px step down off the teal onto the grey goal floor
    { name: 'grey_mid', sx: 110, sy: 1058, r: 10, speed: 30, brake: 2 },
    { name: 'pad_in', sx: 118, sy: 1080, r: 8, speed: 30, brake: 2 },
    { name: 'pad_mid', sx: 150, sy: 1095, r: 8, speed: 30, brake: 2 },
    { name: 'goal', sx: 184, sy: 1108, r: 10, speed: 30 },
  ],
  3: [
    // tower -> scripted arch slide lands on the left WING walkway (z 240)
    { name: 'tower', sx: 45, sy: 52 },
    { name: 'wing_land', sx: 66, sy: 128, r: 12 },
    { name: 'wing1', sx: 52, sy: 131, r: 10, speed: 30, brake: 2 },
    { name: 'wing2', sx: 38, sy: 142, r: 8, speed: 25, brake: 3 },      // the walkway runs to the map's left edge: crawl round the bend
    { name: 'wing2b', sx: 18, sy: 150, r: 8, speed: 25, brake: 2 },
    { name: 'wing3', sx: 11, sy: 160, r: 6, speed: 25, brake: 2 },   // the walkway is only 20 px wide here, hugging the map edge
    { name: 'wing3b', sx: 12, sy: 172, r: 8, speed: 30, brake: 2.5 },
    { name: 'wing4', sx: 20, sy: 190, r: 10, speed: 35 },
    { name: 'wing4b', sx: 16, sy: 208, r: 8, speed: 35 },
    { name: 'wing5', sx: 12, sy: 224, r: 8, speed: 30 },
    { name: 'wing5b', sx: 12, sy: 236, r: 8, speed: 30, brake: 2 },
    { name: 'wing6', sx: 22, sy: 246, r: 6, speed: 30, brake: 2 },
    { name: 'wing_corner', sx: 42, sy: 252, r: 5, speed: 30, brake: 1.5 },
    // 16 px drop off the wing's corner tip onto the steep left ramp (224 -> 176) which runs screen down-right (+u)
    { name: 'ramp_top', sx: 55, sy: 273, r: 6, speed: 30 },      // under the raised cross's corner (cut out of the collision)
    { name: 'ramp_mid', sx: 70, sy: 300, r: 8, speed: 35, brake: 3.5 },   // steep: start shedding speed early
    { name: 'ramp_mid2', sx: 78, sy: 314, r: 8, speed: 30, brake: 2.5 },
    { name: 'ramp_foot', sx: 84, sy: 328, r: 10, speed: 30, brake: 0.8 },   // the pad ends 2.5 tiles on in +u: arrive slow
    // middle "maze": floating pads with real gaps. Left L-pad, its arm down-right (+u), the turn, then down-left (+v)
    // the ramp lands on the upper-right bump of one long strip that runs +u (screen down-right); centre up on it
    { name: 'm0', sx: 70, sy: 344, r: 8, speed: 30, brake: 1.5 },
    { name: 'm1', sx: 64, sy: 356, r: 8, speed: 30, brake: 2 },
    { name: 'm2', sx: 62, sy: 364, r: 8, speed: 30, brake: 2 },
    { name: 'm3', sx: 78, sy: 371, r: 8, speed: 35, brake: 3 },
    { name: 'm4', sx: 92, sy: 377, r: 10, speed: 35, brake: 3 },
    { name: 'm5', sx: 110, sy: 386, r: 10, speed: 35, brake: 3 },
    { name: 'm6', sx: 131, sy: 396, r: 10, speed: 35, brake: 3 },
    { name: 'm7', sx: 152, sy: 406, r: 10, speed: 35, brake: 2.5 },
    { name: 'm8', sx: 166, sy: 414, r: 8, speed: 30, brake: 2 },
    { name: 'm8b', sx: 176, sy: 421, r: 6, speed: 30, brake: 1.5 },
    // the turn: back down-left (+v) along the lower arm
    { name: 'm9', sx: 166, sy: 428, r: 8, speed: 30, brake: 2 },
    { name: 'm10', sx: 150, sy: 436, r: 10, speed: 35, brake: 3 },
    { name: 'm11', sx: 134, sy: 444, r: 10, speed: 35, brake: 3 },
    { name: 'm12', sx: 118, sy: 452, r: 10, speed: 35, brake: 3 },
    { name: 'm13', sx: 102, sy: 460, r: 8, speed: 35, brake: 2.5 },
    { name: 'm13b', sx: 88, sy: 470, r: 8, speed: 30, brake: 2 },
    // junction -> the big middle floor (pillars around x 125-155, y 510-550 are left alone) -> funnel
    { name: 'j1', sx: 100, sy: 492, r: 10 },
    { name: 'j2', sx: 100, sy: 510, r: 10 },
    { name: 'j3', sx: 100, sy: 530, r: 10 },
    { name: 'm15', sx: 108, sy: 550, r: 10 },
    { name: 'm16', sx: 128, sy: 570, r: 10 },
    { name: 'm17', sx: 148, sy: 590, r: 10 },
    { name: 'm18', sx: 160, sy: 612, r: 10 },
    { name: 'm19', sx: 163, sy: 630, r: 8, speed: 35, brake: 2 },
    { name: 'funnel', sx: 162, sy: 646, r: 6, speed: 35 },
    // funnel pipe -> catwalk (129) -> roll off its front edge: 48 px drop onto the plate level (81, dizzy)
    { name: 'catwalk_land', sx: 150, sy: 775, r: 10, speed: 40 },
    { name: 'cw1', sx: 167, sy: 789, r: 8, speed: 40 },
    { name: 'cw2', sx: 187, sy: 800, r: 8, speed: 40 },
    { name: 'cw_edge', sx: 200, sy: 812, r: 8, speed: 35 },
    { name: 'plate_land', sx: 190, sy: 870, r: 14, speed: 40 },
    { name: 'plate_end', sx: 200, sy: 882, r: 8, speed: 30, brake: 2 },
    // roll off the plate's lower-left edge: 13 px drop onto the bright wavy ribbon that starts under the plate
    { name: 'pad_B', sx: 196, sy: 902, r: 8, speed: 30, brake: 2 },
    { name: 'w1', sx: 185, sy: 912, r: 8, speed: 30, brake: 2.5 },
    { name: 'w2', sx: 175, sy: 921, r: 8, speed: 30, brake: 2.5 },
    { name: 'w3', sx: 163, sy: 930, r: 8, speed: 30, brake: 2.5 },
    { name: 'w4', sx: 155, sy: 939, r: 6, speed: 30, brake: 2 },
    { name: 'w5', sx: 147, sy: 948, r: 6, speed: 30, brake: 2 },     // the ribbon bends to straight down here
    { name: 'w6', sx: 141, sy: 957, r: 6, speed: 30, brake: 2 },
    { name: 'cross', sx: 141, sy: 964, r: 6, speed: 30, brake: 2 },  // onto the dark ribbon (wave_G) heading down-right
    { name: 'g1', sx: 148, sy: 968, r: 6, speed: 30, brake: 2 },
    { name: 'g2', sx: 153, sy: 974, r: 6, speed: 30, brake: 2.5 },
    { name: 'g3', sx: 160, sy: 982, r: 6, speed: 30, brake: 2.5 },
    { name: 'g4', sx: 170, sy: 990, r: 6, speed: 30, brake: 2.5 },
    { name: 'g5', sx: 180, sy: 998, r: 6, speed: 30, brake: 2.5 },
    { name: 'g_end', sx: 184, sy: 1002, r: 6, speed: 30, brake: 2 },
    // 10 px drop off the ribbon's end onto the goal pad
    { name: 'goal_pad', sx: 198, sy: 1012, r: 8, speed: 30, brake: 2 },
    { name: 'goal_pad2', sx: 208, sy: 1022, r: 8, speed: 30, brake: 2 },
    { name: 'goal', sx: 222, sy: 1034, r: 10, speed: 30 },
  ],
  4: [
    // right tower -> scripted crossing slide lands on the LEFT pad (z 215)
    { name: 'tower', sx: 250, sy: 55 },
    { name: 'land', sx: 56, sy: 224, r: 12 },
    // pad is an L: go RIGHT along the pad, then onto the strip (do not cut the inside corner)
    { name: 'pad_r', sx: 78, sy: 226, r: 8, speed: 25, brake: 2 },
    { name: 'pad_neck', sx: 85, sy: 232, r: 6, speed: 25, brake: 2 },
    { name: 'strip', sx: 90, sy: 242, r: 8, speed: 30, brake: 2 },
    // land_L zigzag 215: down-right
    { name: 'c1', sx: 107, sy: 260, r: 8, speed: 35 },
    { name: 'c2', sx: 128, sy: 272, r: 8, speed: 35 },
    { name: 'c3', sx: 152, sy: 284, r: 8, speed: 35 },
    { name: 'c4', sx: 172, sy: 296, r: 8, speed: 30, brake: 2 },
    // turn down-left
    { name: 'c5', sx: 150, sy: 308, r: 8, speed: 30, brake: 2 },
    { name: 'c6', sx: 126, sy: 320, r: 8, speed: 35, brake: 2 },
    { name: 'c7', sx: 102, sy: 332, r: 8, speed: 35, brake: 2 },
    { name: 'c8', sx: 78, sy: 344, r: 8, speed: 35, brake: 2 },
    { name: 'c9', sx: 54, sy: 356, r: 8, speed: 30, brake: 2 },
    { name: 'c10', sx: 30, sy: 368, r: 8, speed: 25, brake: 2 },
    // turn down-right
    { name: 'c11', sx: 40, sy: 380, r: 8, speed: 30, brake: 2 },
    { name: 'c12', sx: 64, sy: 392, r: 8, speed: 35 },
    { name: 'c13', sx: 88, sy: 404, r: 8, speed: 35 },
    { name: 'c14', sx: 112, sy: 416, r: 8, speed: 35 },
    { name: 'c15', sx: 136, sy: 428, r: 8, speed: 25, brake: 2 },
    { name: 'c16', sx: 130, sy: 430, r: 6, speed: 15, brake: 2 },
    { name: 'dl1', sx: 110, sy: 448, r: 6, speed: 15, brake: 2 },
    { name: 'dl2', sx: 90, sy: 463, r: 6, speed: 15, brake: 2 },
    { name: 'dl3', sx: 70, sy: 466, r: 6, speed: 15, brake: 2 },
    { name: 'pink_l1', sx: 50, sy: 466, r: 8, speed: 22, brake: 2 },
    { name: 'pink_l2', sx: 32, sy: 484, r: 10, speed: 30, brake: 2 },
    { name: 'pink_l2b', sx: 20, sy: 496, r: 8, speed: 28, brake: 2 },
    { name: 'pink_l3', sx: 17, sy: 508, r: 8, speed: 28, brake: 2 },
    { name: 'pink_l4', sx: 32, sy: 520, r: 6, speed: 22, brake: 2 },
    { name: 'pink_edge', sx: 32, sy: 526, r: 5, speed: 12, brake: 2 },
    { name: 'pink_join', sx: 44, sy: 526, r: 5, speed: 12, brake: 2 },
    { name: 'pink_lip', sx: 54, sy: 530, r: 5, speed: 12, brake: 2 },
    { name: 'g6', sx: 110, sy: 604, r: 8, speed: 20, brake: 2 },
    { name: 'g7', sx: 86, sy: 616, r: 8, speed: 30, brake: 2 },
    { name: 'g8', sx: 92, sy: 628, r: 8, speed: 25, brake: 2 },
    // green (z108) ends at a painted 72-px cliff; the mid floor (z36) is directly below its south-west edge.
    // Roll off the edge (dizzy landing, under the 80 shatter limit) onto mid_L; there is no ramp in the art.
    // Roll off with some pace: a marble that trickles over lands at the very foot of the face, in the one-cell
    // pocket between the face's base band and the overhang, and has to be nudged out.
    { name: 'g9', sx: 112, sy: 626, r: 6, speed: 25, brake: 2 },
    { name: 'green_edge', sx: 98, sy: 634, r: 6, speed: 22 },
    { name: 'mid_land', sx: 72, sy: 724, r: 12, speed: 20 },
    { name: 'mid_settle', sx: 66, sy: 724, r: 8, speed: 12, brake: 2 },
    { name: 'mid_j', sx: 80, sy: 720, r: 5, speed: 15, brake: 2 },
    { name: 'mid_left', sx: 70, sy: 720, r: 6, speed: 15, brake: 2 },
    { name: 'mid1', sx: 38, sy: 720, r: 8, speed: 15, brake: 2 },
    { name: 'mid2', sx: 26, sy: 732, r: 8, speed: 30, brake: 2 },
    { name: 'mid3', sx: 48, sy: 744, r: 8, speed: 30 },
    { name: 'mid4', sx: 60, sy: 750, r: 8, speed: 30 },
    { name: 'mid5', sx: 72, sy: 756, r: 6, speed: 12, brake: 2 },
    { name: 'mid6', sx: 92, sy: 772, r: 5, speed: 12, brake: 2 },
    // the painted white chute (mid 36 -> low -32): a half-pipe, so aim for its centreline
    // the painted white chute (mid 36 -> low -32) is a plane z(x): steep, straight, along the screen-horizontal
    // world axis; stay on one depth line (s = y + z = 822) so each waypoint is a point on that ramp
    { name: 'chute_top', sx: 114, sy: 786, r: 5, speed: 12, brake: 2 },
    { name: 'chute_1', sx: 108, sy: 809, r: 5, speed: 12, brake: 2 },
    { name: 'chute_2', sx: 100, sy: 839, r: 6, speed: 12, brake: 2 },
    { name: 'chute_foot', sx: 94, sy: 856, r: 8, speed: 12, brake: 2 },
    { name: 'low5', sx: 88, sy: 852, r: 10, speed: 16, brake: 2 },
    { name: 'low6', sx: 78, sy: 854, r: 8, speed: 18, brake: 2 },
    { name: 'low7', sx: 80, sy: 860, r: 8, speed: 18, brake: 2 },
    { name: 'low9', sx: 104, sy: 872, r: 10, speed: 18, brake: 2 },
    { name: 'low10', sx: 116, sy: 878, r: 8, speed: 15, brake: 2 },
    { name: 'low11', sx: 110, sy: 888, r: 8, speed: 15, brake: 2 },
    { name: 'low12', sx: 95, sy: 896, r: 8, speed: 15, brake: 2 },
    { name: 'low12c', sx: 78, sy: 908, r: 8, speed: 15, brake: 2 },
    { name: 'low13', sx: 66, sy: 914, r: 10, speed: 18, brake: 2 },
    { name: 'low15', sx: 42, sy: 926, r: 10, speed: 20, brake: 2 },
    { name: 'low16', sx: 30, sy: 932, r: 10, speed: 22, brake: 2 },
    { name: 'low17', sx: 24, sy: 944, r: 8, speed: 22, brake: 2 },
    { name: 'low18', sx: 32, sy: 950, r: 8, speed: 18, brake: 2 },
    { name: 'goal_join', sx: 30, sy: 949, r: 6, speed: 14, brake: 2 },
    { name: 'goal_a', sx: 44, sy: 958, r: 6, speed: 14, brake: 2 },
    { name: 'goal_b', sx: 60, sy: 968, r: 8, speed: 16, brake: 2 },
    { name: 'goal', sx: 88, sy: 975, r: 12, speed: 25 },
  ],
  5: [
    // bottom floor (z100), left of the recessed pit; climb the white ribbon (ramp B) up-right
    { name: 'bottom_start', sx: 60, sy: 1060 },
    { name: 'foot', sx: 76, sy: 1052, r: 8, speed: 30 },
    { name: 'w5a', sx: 90, sy: 1040, r: 7, speed: 45 },
    { name: 'w5b', sx: 106, sy: 1022, r: 7, speed: 50 },
    { name: 'w5c', sx: 120, sy: 1008, r: 7, speed: 50 },
    { name: 'w5d', sx: 130, sy: 998, r: 7, speed: 50 },
    { name: 'x2', sx: 142, sy: 990, r: 6, speed: 50 },
    { name: 'w4a', sx: 154, sy: 982, r: 7, speed: 50 },
    { name: 'w4b', sx: 170, sy: 964, r: 7, speed: 50 },
    { name: 'w4c', sx: 180, sy: 954, r: 6, speed: 45, brake: 3 },
    // right vertex of the rhombus: turn up-left onto the grey ribbon (G1)
    { name: 'vertex', sx: 186, sy: 950, r: 6, speed: 35, brake: 2.5 },
    { name: 'g1a', sx: 174, sy: 938, r: 6, speed: 35, brake: 3 },
    { name: 'g1b', sx: 161, sy: 926, r: 6, speed: 35, brake: 3 },
    { name: 'g1c', sx: 149, sy: 914, r: 6, speed: 35, brake: 3 },
    { name: 'g1d', sx: 133, sy: 899, r: 6, speed: 32, brake: 2.5 },
    { name: 'g1e', sx: 119, sy: 886, r: 6, speed: 32, brake: 2.5 },
    { name: 'plaza_edge', sx: 107, sy: 869, r: 6, speed: 32, brake: 2.5 },
    { name: 'plaza_in', sx: 110, sy: 850, r: 8, speed: 30, brake: 2 },
    { name: 'plaza_mid', sx: 150, sy: 830, r: 10, speed: 30, brake: 2 },
    // west across the plaza rim to the white stairs in the far-left corner, up them, then the connector to the V ledge
    { name: 'plaza_w1', sx: 118, sy: 866, r: 8, speed: 30, brake: 2 },
    { name: 'plaza_w2', sx: 100, sy: 874, r: 7, speed: 30, brake: 2 },
    { name: 'corridor', sx: 82, sy: 881, r: 6, speed: 30, brake: 2 },
    { name: 'stairs_foot', sx: 60, sy: 889, r: 6, speed: 30, brake: 2 },
    { name: 'stairs_1', sx: 46, sy: 877, r: 6, speed: 40, brake: 3 },
    { name: 'stairs_2', sx: 34, sy: 860, r: 6, speed: 40, brake: 3 },
    { name: 'stairs_3', sx: 24, sy: 842, r: 6, speed: 40, brake: 3 },
    { name: 'stairs_4', sx: 16, sy: 824, r: 6, speed: 40, brake: 3 },
    { name: 'stairs_top', sx: 12, sy: 808, r: 6, speed: 40, brake: 3 },
    { name: 'conn_1', sx: 10, sy: 780, r: 6, speed: 40, brake: 3 },
    { name: 'conn_2', sx: 10, sy: 752, r: 6, speed: 40, brake: 3 },
    { name: 'arm_end', sx: 14, sy: 734, r: 6, speed: 38, brake: 3 },
    // V ledge left arm (z240) up-right, then the ramp over region L to the upper ledge (z280)
    { name: 'l_ramp_0', sx: 24, sy: 723, r: 5, speed: 30, brake: 2.5 },
    { name: 'l_ramp_1', sx: 34, sy: 712, r: 5, speed: 30, brake: 2.5 },
    { name: 'l_ramp_2', sx: 52, sy: 690, r: 5, speed: 30, brake: 2.5 },
    { name: 'l_ramp_3', sx: 70, sy: 668, r: 5, speed: 30, brake: 2.5 },
    { name: 'l_ramp_4', sx: 88, sy: 644, r: 6, speed: 30, brake: 2.5 },
    { name: 'upper_1', sx: 106, sy: 622, r: 6, speed: 25, brake: 2 },
    { name: 'upper_2', sx: 128, sy: 606, r: 6, speed: 25, brake: 2 },
    { name: 'upper_3', sx: 138, sy: 600, r: 5, speed: 20, brake: 1.5 },
    { name: 'green_1', sx: 148, sy: 584, r: 5, speed: 35, brake: 3 },
    { name: 'green_1b', sx: 158, sy: 568, r: 6, speed: 35, brake: 3 },
    { name: 'green_2', sx: 168, sy: 540, r: 8, speed: 35, brake: 3 },
    { name: 'stairs_g1', sx: 168, sy: 516, r: 6, speed: 40, brake: 3 },
    { name: 'stairs_g2', sx: 172, sy: 492, r: 6, speed: 45, brake: 3 },
    { name: 'orange_1', sx: 178, sy: 466, r: 7, speed: 35, brake: 3 },
    { name: 'orange_2', sx: 194, sy: 440, r: 8, speed: 35, brake: 3 },
    { name: 'orange_3', sx: 218, sy: 404, r: 8, speed: 35, brake: 3 },
    { name: 'orange_4', sx: 248, sy: 352, r: 8, speed: 35, brake: 3 },
    { name: 'orange_5', sx: 270, sy: 342, r: 7, speed: 35, brake: 3 },
    { name: 'red_ramp_foot', sx: 272, sy: 346, r: 6, speed: 45, brake: 3.5 },
    { name: 'red_ramp_mid', sx: 269, sy: 312, r: 6, speed: 50, brake: 4 },
    { name: 'red_ramp_top', sx: 268, sy: 282, r: 6, speed: 45, brake: 4 },
    { name: 'red_1', sx: 268, sy: 256, r: 5, speed: 35, brake: 3 },
    { name: 'red_2', sx: 266, sy: 246, r: 6, speed: 35, brake: 3 },
    { name: 'red_3', sx: 250, sy: 236, r: 6, speed: 35, brake: 3 },
    { name: 'red_4', sx: 240, sy: 240, r: 5, speed: 30, brake: 2 },
    { name: 'rs_0', sx: 237, sy: 232, r: 5, speed: 40, brake: 2.5 },
    { name: 'rs_1', sx: 232, sy: 222, r: 5, speed: 42, brake: 4 },
    { name: 'rs_2', sx: 228, sy: 206, r: 5, speed: 42, brake: 4 },
    { name: 'rs_3', sx: 225, sy: 190, r: 5, speed: 42, brake: 4 },
    { name: 'summit_1', sx: 220, sy: 176, r: 6, speed: 35, brake: 3 },
    { name: 'summit_2', sx: 206, sy: 164, r: 8, speed: 35, brake: 3 },
    { name: 'summit_3', sx: 180, sy: 156, r: 8, speed: 35, brake: 3 },
    { name: 'summit_4', sx: 150, sy: 144, r: 8, speed: 35, brake: 3 },
    { name: 'summit_5', sx: 120, sy: 130, r: 8, speed: 35, brake: 3 },
    { name: 'gs_ramp0', sx: 108, sy: 123, r: 6, speed: 40, brake: 3 },
    { name: 'gs_ramp', sx: 90, sy: 106, r: 6, speed: 50, brake: 3 },
    { name: 'gs_ramp2', sx: 70, sy: 88, r: 6, speed: 50, brake: 3 },
    { name: 'goal_side', sx: 50, sy: 68, r: 6, speed: 35, brake: 3 },
    { name: 'gs_2', sx: 58, sy: 56, r: 6, speed: 30, brake: 2.5 },
    { name: 'ge_1', sx: 72, sy: 52, r: 6, speed: 30, brake: 2.5 },
    { name: 'goal_entry', sx: 88, sy: 50, r: 6, speed: 30, brake: 2.5 },
    { name: 'ge_2', sx: 106, sy: 52, r: 6, speed: 30, brake: 2.5 },
    { name: 'goal_pad', sx: 126, sy: 58, r: 7, speed: 30, brake: 2.5 },
    { name: 'goal', sx: 152, sy: 71, r: 8, speed: 30 },
  ],
  6: [
    { name: 'start_top', sx: 120, sy: 96 },
    { name: 'slide_landing', sx: 162, sy: 158, r: 8, speed: 25, brake: 2 },
    { name: 'first_island_edge', sx: 175, sy: 164, r: 6, speed: 35, brake: 2 },
    { name: 'second_island_entry', sx: 175, sy: 184, r: 8, speed: 35, brake: 2 },
    { name: 'second_island_mid', sx: 181, sy: 190, r: 8, speed: 35, brake: 2 },
    { name: 'second_island_edge', sx: 189, sy: 192, r: 6, speed: 45, brake: 2 },
    { name: 'glass_island_entry', sx: 196, sy: 205, r: 8, speed: 45, brake: 2 },
    // west across the grey glass-island course to the left glass bridge (cyan, z65)
    { name: 'gi_1', sx: 184, sy: 201, r: 6, speed: 30, brake: 2 },
    { name: 'gi_2', sx: 173, sy: 195, r: 6, speed: 30, brake: 2 },
    { name: 'gi_3', sx: 161, sy: 195, r: 6, speed: 30, brake: 2 },
    { name: 'gi_4', sx: 150, sy: 200, r: 6, speed: 30, brake: 2 },
    { name: 'gi_5', sx: 138, sy: 203, r: 6, speed: 30, brake: 2 },
    { name: 'gi_6', sx: 126, sy: 203, r: 6, speed: 30, brake: 2 },
    { name: 'gi_7', sx: 114, sy: 206, r: 6, speed: 30, brake: 2 },
    { name: 'gi_8', sx: 105, sy: 215, r: 6, speed: 30, brake: 2 },
    { name: 'gi_9', sx: 96, sy: 226, r: 6, speed: 30, brake: 2 },
    { name: 'glass_L_1', sx: 87, sy: 238, r: 6, speed: 30, brake: 2 },
    { name: 'glass_L_2', sx: 76, sy: 241, r: 6, speed: 30, brake: 2 },
    { name: 'glass_L_3', sx: 64, sy: 246, r: 6, speed: 30, brake: 2 },
    { name: 'glass_L_end', sx: 55, sy: 248, r: 6, speed: 30, brake: 2 },
    // orange plateau (z65): down its west side, then along its south-east edge to the drop onto the middle terrace (z33)
    { name: 'orange_1', sx: 52, sy: 258, r: 6, speed: 30, brake: 2 },
    { name: 'orange_2', sx: 49, sy: 270, r: 6, speed: 30, brake: 2 },
    { name: 'orange_3', sx: 57, sy: 279, r: 6, speed: 30, brake: 2 },
    { name: 'orange_4', sx: 66, sy: 288, r: 6, speed: 30, brake: 2 },
    { name: 'orange_5', sx: 75, sy: 297, r: 6, speed: 30, brake: 2 },
    { name: 'orange_6', sx: 84, sy: 306, r: 6, speed: 30, brake: 2 },
    { name: 'orange_7', sx: 93, sy: 315, r: 6, speed: 25, brake: 2 },
    { name: 'orange_drop_edge', sx: 102, sy: 330, r: 5, speed: 34 },
    { name: 'middle_landing', sx: 100, sy: 372, r: 10, speed: 30, brake: 2 },
    // upper middle terrace (z33) west, then the ramp down (33 -> 1) onto the ribbon to the arena drop
    { name: 'mid_u1', sx: 100, sy: 378, r: 6, speed: 30, brake: 2 },
    { name: 'mid_u2', sx: 95, sy: 390, r: 6, speed: 30, brake: 2 },
    { name: 'mid_u3', sx: 86, sy: 399, r: 6, speed: 30, brake: 2 },
    { name: 'mid_u4', sx: 77, sy: 408, r: 6, speed: 30, brake: 2 },
    { name: 'mid_u5', sx: 68, sy: 417, r: 6, speed: 30, brake: 2 },
    { name: 'mid_u6', sx: 57, sy: 423, r: 6, speed: 30, brake: 2 },
    { name: 'mid_u7', sx: 45, sy: 423, r: 6, speed: 30, brake: 2 },
    { name: 'mid_u8', sx: 33, sy: 424, r: 6, speed: 30, brake: 2 },
    { name: 'mid_u9', sx: 24, sy: 433, r: 6, speed: 30, brake: 2 },
    { name: 'ramp_top', sx: 22, sy: 445, r: 6, speed: 30, brake: 2 },
    { name: 'ramp_1', sx: 28, sy: 458, r: 6, speed: 30, brake: 2 },
    { name: 'ramp_2', sx: 38, sy: 467, r: 6, speed: 30, brake: 2 },
    { name: 'ramp_3', sx: 49, sy: 473, r: 6, speed: 30, brake: 2 },
    { name: 'ramp_4', sx: 60, sy: 481, r: 6, speed: 30, brake: 2 },
    { name: 'ramp_5', sx: 71, sy: 485, r: 6, speed: 30, brake: 2 },
    { name: 'ramp_6', sx: 83, sy: 486, r: 6, speed: 30, brake: 2 },
    { name: 'ramp_7', sx: 93, sy: 491, r: 6, speed: 30, brake: 2 },
    { name: 'ramp_foot', sx: 102, sy: 497, r: 6, speed: 30, brake: 2 },
    { name: 'ribbon_1', sx: 113, sy: 503, r: 6, speed: 30, brake: 2 },
    { name: 'ribbon_2', sx: 124, sy: 508, r: 6, speed: 30, brake: 2 },
    { name: 'ribbon_3', sx: 135, sy: 514, r: 6, speed: 30, brake: 2 },
    { name: 'middle_checkpoint', sx: 146, sy: 521, r: 8, speed: 30, brake: 2 },
    { name: 'arena_drop_edge', sx: 152, sy: 538, r: 5, speed: 34 },
    { name: 'arena_landing', sx: 162, sy: 612, r: 10, speed: 30, brake: 2 },
    { name: 'arena_recenter', sx: 140, sy: 620, r: 10, speed: 30, brake: 2 },
    { name: 'arena_mid', sx: 140, sy: 630, r: 8, speed: 30, brake: 2 },
    { name: 'goal_drop_edge', sx: 155, sy: 635, r: 6, speed: 25, brake: 2 },
    { name: 'goal_landing', sx: 164, sy: 701, r: 10, speed: 30, brake: 2 },
  ],
};

const wps = WAYPOINTS[stage] || WAYPOINTS[1];
// every stage steers in world space (waypoints resolved to u,v,z via mmDebug.pick); SCREEN_STEER=1 forces the legacy screen-space model
// Waypoints are MAP PIXELS. Resolve each one onto the floor drawn there so steering happens in world space:
// a pixel 20 px "down" on the screen can be a floor 16 units lower straight ahead, not a floor diagonally ahead.
{
  const picks = await page.evaluate((pts) => pts.map(([x, y]) => (window.mmDebug.pick ? window.mmDebug.pick(x, y)[0] : null) || null), wps.map((w) => [w.sx, w.sy]));
  picks.forEach((pk, i) => {
    if (pk && process.env.SCREEN_STEER) { wps[i].floor = pk.name; wps[i].z = pk.z; return; }   // SCREEN_STEER=1: legacy screen-space steering
    if (pk) { wps[i].u = pk.u; wps[i].v = pk.v; wps[i].z = pk.z; wps[i].floor = pk.name; }
    else console.log(`⚠ waypoint #${i} (${wps[i].name}) at (${wps[i].sx}, ${wps[i].sy}) is not over any floor`);
  });
  console.log('waypoints: ' + wps.map((w, i) => `#${i} ${w.name} (${w.sx},${w.sy}) -> ${w.u !== undefined ? `z${w.z} ${w.floor}` : '??'}`).join(' | '));
}
/** screen distance from the marble to a waypoint, measured on the waypoint's floor plane */
const dist2 = (m, w) => w.u !== undefined
  ? Math.hypot((w.u - m.u) * 8 - (w.v - m.v) * 8, (w.u - m.u) * 4 + (w.v - m.v) * 4)
  : Math.hypot(w.sx - m.sx, w.sy - m.sy);
let wpIdx = 1; // start moving to first target
let reachedGoal = false;
let lastDeaths = 0;
const trace = [];
let stallTicks = 0;
let lastPos = null;

console.log(`Navigating through ${wps.length} waypoints using mmDebug...`);

for (let tick = 0; tick < 900 && !reachedGoal; tick++) {
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

  if (m.screen === 'title' || m.screen === 'gameover' || m.screen === 'menu') { console.log(`race over (screen ${m.screen}) at tick ${tick} without reaching the goal`); break; }
  if (tick % 20 === 0) await page.evaluate(() => window.mmDebug.clock && window.mmDebug.clock(200));   // collision test, not a time trial
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
      const d = dist2(m, wps[i]);
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
  // teleported (pipe exit, respawn): resync to the closest waypoint ahead when the current one is far away
  {
    const dCur = dist2(m, wps[wpIdx]);
    if (dCur > 60) {
      let best = wpIdx, bd = dCur;
      for (let k = wpIdx + 1; k < wps.length; k++) { const d = dist2(m, wps[k]); if (d < bd) { bd = d; best = k; } }
      if (best !== wpIdx && bd < 40) { console.log(`↷ resync: marble at (${m.sx}, ${m.sy}) is ${bd.toFixed(0)} px from #${best} (${wps[best].name}); skipping ${best - wpIdx} waypoint(s)`); wpIdx = best; }
    }
  }
  while (wpIdx < wps.length - 1) {
    const t = wps[wpIdx], n = wps[wpIdx + 1];
    const dT = dist2(m, t), dN = dist2(m, n), seg = Math.hypot(n.sx - t.sx, n.sy - t.sy);
    if (dT < (t.r ?? 18) || (dN < seg * 0.5 && dT < seg) || (dN < dT && dN < 30)) {
      console.log(`✓ Reached waypoint #${wpIdx} (${t.name}) at (${m.sx}, ${m.sy}). Next: ${n.name}`);
      wpIdx++;
    } else break;
  }

  // Calculate normalized steering direction
  const currTarget = wps[wpIdx];
  // direction in world space (u right-down, v left-down), expressed as the screen direction the trackball wants
  let tdx, tdy;
  if (currTarget.u !== undefined) { const du = currTarget.u - m.u, dv = currTarget.v - m.v; tdx = du - dv; tdy = (du + dv) / 2; }
  else { tdx = currTarget.sx - m.sx; tdy = currTarget.sy - m.sy; }
  const tdist = dist2(m, currTarget) || 1;
  const tl = Math.hypot(tdx, tdy) || 1;
  const nx = tdx / tl;
  const ny = tdy / tl;
  // Trackball model is heavy (impulse + bearing friction), so pulse it every tick. Ease off near a waypoint
  // and when the marble is already fast, so it can take the corners instead of flying off.
  const sp = Math.hypot(m.vu ?? 0, m.vv ?? 0);
  let speed = currTarget.speed ?? (tdist < 30 ? 55 : 80);
  if (sp > 6) speed = Math.min(speed, 40);

  // Apply trackball spin via mmDebug. Waypoints with `brake` counter-spin while the marble is faster than
  // that many tiles/s (there are no brakes on the cabinet: reverse the ball).
  let cmd = [nx, ny, speed];
  // carried by a scripted slide / a pipe, or stunned after a landing: a player grabs the ball and waits
  if (m.slide || m.inPipe || (m.dizzy > 0 && m.grounded && sp < 3)) {
    await page.evaluate(() => window.mmDebug.grab && window.mmDebug.grab());
    await page.waitForTimeout(150);
    continue;
  }
  if (currTarget.brake && sp > currTarget.brake) {
    const vsx = (m.vu - m.vv), vsy = (m.vu + m.vv) / 2, vl = Math.hypot(vsx, vsy) || 1;   // velocity in screen space
    cmd = [-vsx / vl, -vsy / vl, 70];
  }
  // stages with reversed controls (stage 5 "everything you know is wrong") invert the trackball: pre-invert the spin
  if (controlsReversed) cmd = [-cmd[0], -cmd[1], cmd[2]];
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

// A recording is evidence, not success by itself. Make this harness fail loudly when the driven
// production run does not finish or when the browser reports a runtime error.
// stage 5 (Silly Race) climbs the whole way: a clean run has no drop, so its evidence is the trace itself (samples + blocks)
const requiredEvents = stage <= 2 ? ['block', 'airborne', 'land'] : stage === 5 ? ['sample'] : ['airborne'];
const missingEvents = requiredEvents.filter((event) => !counts[event]);
if (missingEvents.length) console.log(`Missing required physics evidence: ${missingEvents.join(', ')}`);
const passed = reachedGoal && !errors.length && !missingEvents.length && wpIdx === wps.length - 1;
console.log(passed ? `STAGE ${stage} RECORDED PLAYTEST: PASS` : `STAGE ${stage} RECORDED PLAYTEST: FAIL`);
process.exit(passed ? 0 : 1);
