import { LevelBuilder } from '../engine/level';

/**
 * PRACTICE RACE (arcade map stage1.png, 290x577).
 *
 * The picture is the only floor: collision is the art-derived heightfield (stage1.labels.png +
 * stage1.comps.json, see tools/labels_to_comps.py, tools/fit_slopes.py, tools/patch_stage1.py).
 * Rails, the post, the tents and the tent block are wall pixels in that map, so nothing here is
 * a surface. This file only places the start, respawn checkpoints and scoring zones, each anchored
 * to a MAP PIXEL and resolved onto the floor drawn there when the heightfield loads.
 */
const L = new LevelBuilder({
  id: 1, name: 'PRACTICE RACE', music: 'practice', image: 'stages/stage1.png',
  width: 290, height: 577, timeAdd: 60, carryTime: false,
});

// --- start & checkpoints (checkpoint zone value = index in the checkpoint list) ---------------
L.startPx(145, 25);                                              // top of the rolling hills
L.checkpointPx(145, 25);                                         // 0: start
L.checkpointPx(150, 220, { r: 8, value: 1, id: 'cp0' });         // 1: plateau below the tent block
L.checkpointPx(135, 300, { r: 6, value: 2, id: 'cp1' });         // 2: chute mouth between the rails
L.checkpointPx(140, 390, { r: 4, value: 3, id: 'cp2' });         // 3: lower bend of the chute
L.checkpointPx(120, 500, { r: 6, value: 4, id: 'cp3' });         // 4: bottom floor before the goal

// --- scoring: red/white pads on the side areas and the goal ------------------------------
L.zonePx('bonus', 236, 396, 1.6, 5000, 'padA');
L.zonePx('bonus', 30, 441, 1.6, 1000, 'padB');
L.zonePx('bonus', 232, 486, 1.6, 1000, 'padC');
L.zonePx('bonus', 40, 538, 3, 1000, 'goalflags');
L.zonePx('goal', 40, 538, 3.5, undefined, 'goal');

export const stage1 = L.build();
