import { LevelBuilder } from '../engine/level';

/**
 * INTERMEDIATE RACE (arcade map stage3.png, 288x1080).
 *
 * Collision is the art-derived heightfield built by tools/author_stage.py from
 * tools/stage_specs/stage3.json. Heights (top to bottom, from the painted faces):
 *   towers 317 -> slides -> plateau maze 240 (top diamond 248) -> left / right ramps -> middle maze 176
 *   -> funnel pipe -> catwalk 129 -> 48 px drop onto the wave plate level 81 -> wavy chutes -> goal floor 57
 * Everything here is anchored to a MAP PIXEL and resolved onto the floor drawn there.
 */
const L = new LevelBuilder({
  id: 3, name: 'INTERMEDIATE RACE', music: 'intermediate', image: 'stages/stage3.png',
  width: 288, height: 1080, timeAdd: 35, carryTime: true,
});

// --- the two towers and their scripted slides down onto the plateau (arcade: 2player_longplay.mov t=55-63)
// The arch slides land on the outer WING walkways (z 240), not on the raised central cross (256): the cross and
// its diamond are decoration above the pit; the wings lead around the pit to the two steep ramps down to the middle.
const TOWER_Z = 317, PLATEAU_Z = 240;
const slideL = L.slide([[45, 52, TOWER_Z], [58, 62, TOWER_Z], [72, 85, 295], [86, 100, 262], [78, 116, 250], [66, 128, PLATEAU_Z]]);
const slideR = L.slide([[243, 52, TOWER_Z], [230, 62, TOWER_Z], [216, 85, 295], [202, 100, 262], [210, 116, 250], [222, 128, PLATEAU_Z]]);
L.startPx(45, 52, slideL);                                          // P1 (blue): left tower
L.start2Px(243, 52, slideR);                                        // P2 (red): right tower
L.checkpointPx(45, 52);

// --- the central pit is fatal (its platforms are far below the maze) --------------------------------
{ const a = L.uv(150, 300, PLATEAU_Z), b = L.uv(150, 380, PLATEAU_Z); L.zone('kill', Math.min(a.u, b.u) - 6, Math.min(a.v, b.v) - 6, Math.max(a.u, b.u) + 6, Math.max(a.v, b.v) + 6, undefined, 'pit', -100, 120); }

// --- checkpoints ------------------------------------------------------------------------------------
L.checkpointPx(100, 340, { r: 8, value: 1, id: 'cp1' });           // 1: foot of the left ramp, middle maze
L.checkpointPx(160, 600, { r: 8, value: 2, id: 'cp2' });           // 2: middle maze by the funnel
L.checkpointPx(150, 775, { r: 5, value: 3, id: 'cp3' });           // 3: catwalk under the pipe exit
L.checkpointPx(160, 850, { r: 6, value: 4, id: 'cp4' });           // 4: wave plate level

// --- funnel pipe on the middle maze drops the marble onto the catwalk ---------------------------------
L.pipePx(162, 646, 1.6, { x: 150, y: 775, vu: 1.5, vv: 1.5 }, 1.5, 2000);

// --- the wave plate (arcade "wave" that heaves the floor) ---------------------------------------------
{ const a = L.uv(64, 836, 81), b = L.uv(272, 888, 81); L.hazard({ kind: 'wave', u: (a.u + b.u) / 2, v: (a.v + b.v) / 2, period: 2.6, rect: { u0: Math.min(a.u, b.u), v0: Math.min(a.v, b.v) - 4, u1: Math.max(a.u, b.u), v1: Math.max(a.v, b.v) + 4 } }); }

// --- goal -------------------------------------------------------------------------------------------
L.zonePx('goal', 232, 1036, 3.5, undefined, 'goal');

// --- hazards: slimes at the ramp feet, a wand on the maze, a worm on the middle maze ----------------
for (const [x, y] of [[60, 330], [220, 330], [120, 560]] as const) L.hazardPx(x, y, { kind: 'slime', range: 2 });
L.hazard({ kind: 'wand', u: 0, v: 0, band: [150, 260] });
L.hazardPx(200, 520, { kind: 'worm', range: 5 });

export const stage3 = L.build();
