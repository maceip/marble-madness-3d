import { LevelBuilder } from '../engine/level';

/**
 * PRACTICE RACE (arcade map stage1.png, 290x577).
 * Collision comes from the art-derived height map; this file adds start / checkpoints,
 * scoring zones and obstacles that the pixel classifier cannot infer (tents, post, cube cluster).
 * Map-pixel coordinates below were read off the stage image; heights from the solved map.
 */
const L = new LevelBuilder({
  id: 1, name: 'PRACTICE RACE', music: 'practice', image: 'stages/stage1.png',
  width: 290, height: 577, timeAdd: 60, carryTime: false,
});

const Z_TOP = 100;   // plateau level

// --- upper area (hand authored; the height map is cut above y=214) -----------
// rolling hills: one gentle band from the top (z 140) down to the tents (z 122)
const hills = L.band(0, 290, -20, 50, 140, -0.36, 0, 'hills');
// side ramps from the hill level down to the plateau, left and right of the tent block
L.band(0, 98, 196, 8, 122, -2.75, 0, 'rampL');
L.band(198, 290, 196, 8, 122, -2.75, 0, 'rampR');
// the plateau band right below the ramps (the height map plateau starts at y=214+)
L.band(0, 98, 250, 6, 100, 0, 0, 'plateauL');
L.band(198, 290, 250, 6, 100, 0, 0, 'plateauR');
void hills;
// the two tents sit on a raised block with the cube cluster in front: one solid screen-aligned block
L.wallBand(98, 198, 96, 186, 126, 'tentBlock');
L.wallAt(137, 270, Z_TOP, 0.9, 0.9, 'post');
// small tents on the side platforms
L.wallAt(30, 275, 82, 1.2, 1.2, 'tentSL');
L.wallAt(238, 270, 125, 1.2, 1.2, 'tentSR');

// --- chute, goal ramp, side ramp (hand authored; height map cut there) -------
// the chute is a steep half-pipe from the plateau opening down-right to the lip by the goal corridor
// screen-aligned half-pipe bands: straight down the screen with rails on both sides
const chuteA = L.band(124, 188, 316, 14, 100, -2.15, -0.5, 'chuteA'); L.bandRails(chuteA);
const chuteB = L.band(140, 216, 402, 7.5, 70, -4.0, -1.0, 'chuteB'); L.bandRails(chuteB);
// connector: the marble leaves chuteB around map (176,452) z~40 but the goal corridor started too far left, so it
// dropped into the void. Bridge the chuteB exit to the corridor mouth. (verified by driving the WebMCP controls.)
L.strip(176, 430, 55, 205, 470, 40, 4.0, 'chuteToGoal', 0.5);
// goal corridor (dark shaded, with the GOAL sign) runs down-left from the lip to the goal
L.strip(205, 452, 40, 30, 542, 38, 3.6, 'goalCorridor');
L.strip(232, 318, 100, 268, 336, 61, 3.2, 'rampRight');          // plateau -> right floor

// --- start & checkpoints -----------------------------------------------------
// Start on the solid plateau (heightmap comp hm10, z100) at map (150,220). The arcade art starts at the very
// top on the thin `hills` slope, but the marble slides straight off it into the gap behind the tent wall and
// dies at spawn; this spot is verified to settle grounded and roll onto the chute. (Deterministic: place +
// settle with zero input stays grounded.)
const start = L.uv(150, 220, 100);
L.start(start.u, start.v, 100);
L.checkpoint(start.u, start.v);
const cp1 = L.uv(135, 300, Z_TOP); L.checkpoint(cp1.u, cp1.v);
const cp2 = L.uv(172, 402, 70); L.checkpoint(cp2.u, cp2.v);
const cp3 = L.uv(196, 460, 40); L.checkpoint(cp3.u, cp3.v);

// checkpoint zones (progress markers)
const z1 = L.uv(135, 300, Z_TOP); L.zone('checkpoint', z1.u - 6, z1.v - 6, z1.u + 6, z1.v + 6, 1, 'cp1', Z_TOP - 8, Z_TOP + 8);
const z2 = L.uv(172, 402, 70); L.zone('checkpoint', z2.u - 3, z2.v - 3, z2.u + 3, z2.v + 3, 2, 'cp2', 55, 85);
const z3 = L.uv(196, 460, 40); L.zone('checkpoint', z3.u - 3, z3.v - 3, z3.u + 3, z3.v + 3, 3, 'cp3', 28, 55);

// --- scoring: red/white pads and the goal -----------------------------------
// the painted pads are not floor-coloured, so give them explicit floor rects
for (const [px, py, pz] of [[236, 396, 61], [30, 441, 57], [232, 486, 61]] as const) {
  const c = L.uv(px, py, pz); L.rect(c.u - 2.2, c.v - 2.2, c.u + 2.2, c.v + 2.2, pz, 0, 0, 'pad');
}
const padA = L.uv(236, 395, 61); L.zone('bonus', padA.u - 1.6, padA.v - 1.6, padA.u + 1.6, padA.v + 1.6, 5000, 'padA', 50, 75);
const padB = L.uv(30, 440, 57); L.zone('bonus', padB.u - 1.6, padB.v - 1.6, padB.u + 1.6, padB.v + 1.6, 1000, 'padB', 45, 70);
const padC = L.uv(232, 485, 61); L.zone('bonus', padC.u - 1.6, padC.v - 1.6, padC.u + 1.6, padC.v + 1.6, 1000, 'padC', 50, 75);
const goal = L.uv(40, 538, 38);
L.zone('bonus', goal.u - 3, goal.v - 3, goal.u + 3, goal.v + 3, 1000, 'goalflags', 25, 55);
L.zone('goal', goal.u - 3.5, goal.v - 3.5, goal.u + 3.5, goal.v + 3.5, undefined, 'goal', 25, 55);

export const stage1 = L.build();
