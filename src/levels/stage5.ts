import { LevelBuilder } from '../engine/level';

/**
 * SILLY RACE (arcade map stage5.png, 288x1144) — the uphill race.
 *
 * Collision is the art-derived heightfield built by tools/author_stage.py from
 * tools/stage_specs/stage5.json. Heights measured from the painted faces / checker phase:
 *   bottom floor 100 (recessed pit 68) -> zig-zag ribbons -> plaza rim 176 -> V ledge 240
 *   -> upper terraces -> orange -> red castle -> summit -> goal
 * Everything here is anchored to a MAP PIXEL and resolved onto the floor drawn there.
 */
const L = new LevelBuilder({
  id: 5, name: 'SILLY RACE', music: 'silly', image: 'stages/stage5.png',
  width: 288, height: 1144, timeAdd: 20, carryTime: true, progressDir: -1, reverseControls: true,
});

// Both marbles start on the broad bottom floor, left of the recessed centre pit, by the foot of the white ribbon.
L.startPx(60, 1060);
L.start2Px(44, 1052);
L.checkpointPx(60, 1060);

// Checkpoints along the uphill climb
L.checkpointPx(120, 862, { r: 6, value: 1, id: 'cp1' }); // plaza rim (top of the ribbon)
L.checkpointPx(60, 701, { r: 6, value: 2, id: 'cp2' });  // V ledge
L.checkpointPx(200, 432, { r: 6, value: 3, id: 'cp3' }); // orange path

// Goal on the summit platform
L.zonePx('goal', 152, 71, 3.5, undefined, 'goal');
L.zonePx('bonus', 152, 71, 4.0, 2000, 'goalflags');

// Hazards
// Everything you know is wrong: the green slimes on the plaza hand out seconds instead of dissolving the marble
for (const [x, y] of [[110, 800], [190, 800], [150, 780], [120, 845], [180, 845]] as const) {
  L.hazardPx(x, y, { kind: 'slime', range: 1.6, gift: true });
}
L.hazard({ kind: 'birds', u: 0, v: 0, band: [40, 140], period: 7, count: 4 });
L.hazard({ kind: 'wand', u: 0, v: 0, band: [150, 260] });

export const stage5 = L.build();
