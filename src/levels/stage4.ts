import { LevelBuilder } from '../engine/level';

/**
 * AERIAL RACE (arcade map stage4.png, 288x1024).
 *
 * Collision is the art-derived heightfield built by tools/author_stage.py from
 * tools/stage_specs/stage4.json. Heights (top to bottom, from the painted faces / older comps):
 *   towers 285 -> crossing slides -> land_L / land_R 215 -> pink / yellow 168
 *   -> green zigzag 108 -> mid floors 100 -> low path 70 -> goal pad 40
 * Everything here is anchored to a MAP PIXEL and resolved onto the floor drawn there.
 */
const L = new LevelBuilder({
  id: 4, name: 'AERIAL RACE', music: 'aerial', image: 'stages/stage4.png',
  width: 288, height: 1024, timeAdd: 30, carryTime: true,
});

// --- the two towers and the crossing starting ramps (arcade: 2player_longplay.mov t=90-99)
// Scripted roll: no control, cannot fall off; lands with the dizzy spin. P1 (blue) starts on the
// RIGHT tower and lands on the LEFT platform (z 215); P2 starts on the LEFT tower and lands on the right.
const TOWER_Z = 285, LAND_L_Z = 215;
const rampFromLeft = L.slide([[35, 55, TOWER_Z], [52, 60, TOWER_Z], [80, 90, 262], [115, 122, 232], [145, 148, 208], [178, 168, 185], [200, 190, 160], [215, 215, 147]]);
const rampFromRight = L.slide([[250, 55, TOWER_Z], [234, 60, TOWER_Z], [205, 90, 275], [175, 120, 262], [145, 148, 250], [105, 172, 238], [80, 195, 225], [60, 220, LAND_L_Z]]);
L.startPx(250, 55, rampFromRight);
L.start2Px(35, 55, rampFromLeft);
L.checkpointPx(250, 55);

// --- checkpoints ------------------------------------------------------------------------------------
L.checkpointPx(56, 223, { r: 8, value: 1, id: 'cp1' });            // 1: left landing pad
L.checkpointPx(50, 466, { r: 8, value: 2, id: 'cp2' });             // 2: left pink / drop_land
L.checkpointPx(118, 600, { r: 8, value: 3, id: 'cp3' });            // 3: green zigzag
L.checkpointPx(120, 800, { r: 8, value: 4, id: 'cp4' });            // 4: main low ribbon

// --- goal -------------------------------------------------------------------------------------------
// the goal is the painted GOAL pad (z40) at the bottom of the low path, not the bridge that leads onto it
L.zonePx('bonus', 88, 972, 4, 4000, 'goalflags');
L.zonePx('goal', 88, 972, 1.5, undefined, 'goal');   // r in tiles: 3.5 reached 30 px back up the bridge ramp

// --- hazards: vacuums on the upper zigzag, riser pads on the discs, catapult, hammers, steelie ------
for (const [x, y, f] of [[135, 330, 1], [210, 420, -1], [95, 505, 1]] as const) {
  L.hazardPx(x, y, { kind: 'vacuum', range: 3.2, facing: f });
}
for (const [x, y, du, dv] of [[27, 515, 3, -1], [91, 567, 3, -1], [165, 553, 3, 1]] as const) {
  L.hazardPx(x, y, { kind: 'risers', size: [3, 3], period: 3.2, phase: Math.random() * 3, launch: { du, dv } });
}
// Riser discs (z108) sit in the same world column as the land (z215) and pink (z168) floors above them; the
// two-layer heightfield drops the lowest, so the marble fell through the drawn discs. Hardcoded floors instead
// (one of the handful of hand-authored components: pipes, overpasses, catapult, risers).
for (const [x, y, r, name] of [[162, 555, 2.6, 'discH'], [213, 555, 2.2, 'discI'], [186, 564, 1.6, 'discJ']] as const) {
  const c = L.uv(x, y, 108);
  L.rect(c.u - r, c.v - r, c.u + r, c.v + r, 108, 0, 0, name);
}
// green (z108) -> mid_R (z36): 1.13 s of flight at vz 175, so ~1 tile back in (u+v) and ~8.7 tiles across in (u-v);
// the landing is 108 px below the apex, softLand keeps it a dizzy landing instead of a shatter
L.hazardPx(130, 632, { kind: 'catapult', launch: { du: 3.4, dv: -4.3 } });
for (const [x, y, f] of [[150, 930, 1], [205, 905, -1]] as const) {
  L.hazardPx(x, y, { kind: 'hammer', period: 2.4, phase: Math.random() * 2, facing: f });
}
L.hazardPx(200, 700, { kind: 'steelie' });

export const stage4 = L.build();
