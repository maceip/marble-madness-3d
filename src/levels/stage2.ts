import { LevelBuilder } from '../engine/level';

/**
 * BEGINNER RACE (arcade map stage2.png, 288x1160).
 *
 * The picture is the only floor: collision is the art-derived heightfield built by
 * tools/author_stage.py from tools/stage_specs/stage2.json (flat seeds + ramp centrelines).
 * Everything here is anchored to a MAP PIXEL and resolved onto the floor drawn there.
 *
 * Route: plateau (180) -> white ramp -> tent floor (150) -> 32 px ledge drop -> mid floor (118)
 *        -> funnel pipe -> white catwalk -> Y pipe -> lower floor (70) -> teal ramp -> GOAL (40).
 *        Side route: dark slope -> hammer platform (100) -> long slope -> grey zig-zag -> Y pipe.
 */
const L = new LevelBuilder({
  id: 2, name: 'BEGINNER RACE', music: 'beginner', image: 'stages/stage2.png',
  width: 288, height: 1160, timeAdd: 65, carryTime: false,
});

// --- start & checkpoints ------------------------------------------------------------------------
L.startPx(105, 80);                                                // P1 on the open plateau
L.start2Px(184, 30);                                               // P2 in the top saucer
L.checkpointPx(105, 80);                                           // 0: start
L.checkpointPx(127, 430, { r: 8, value: 1, id: 'cp1' });           // 1: tent floor
L.checkpointPx(200, 590, { r: 6, value: 2, id: 'cp2' });           // 2: mid floor by the funnel
L.checkpointPx(205, 712, { r: 4, value: 3, id: 'cp3' });           // 3: catwalk under the pipe exit
L.checkpointPx(250, 905, { r: 4, value: 4, id: 'cp4' });           // 4: floor at the Y pipe's exit

// --- pipes (mouth pixel, half-size in tiles, exit pixel + exit velocity) --------------------------
// funnel on the mid floor drops onto the white catwalk
L.pipePx(245, 612, 2, { x: 205, y: 712, vu: 0.5, vv: 1.5 }, 1.6, 4000);   // mouth pixel is the funnel decal; resolves to the floor beside it
// Y pipe: two inlets (end of the white catwalk, end of the grey zig-zag), one outlet on the lower floor
L.pipePx(158, 794, 1.5, { x: 250, y: 905, vu: 2, vv: 3 }, 1.5, 2000);   // end of the white catwalk
L.pipePx(118, 796, 1.5, { x: 250, y: 905, vu: 2, vv: 3 }, 1.5, 2000);   // end of the grey zig-zag

// --- cone tents on the tent floor are solid ----------------------------------------------------
L.wallAt(123, 402, 150, 1.4, 1.4, 'coneM');
L.wallAt(35, 420, 150, 1.4, 1.4, 'coneL');
L.wallAt(211, 420, 150, 1.4, 1.4, 'coneR');

// --- goal ---------------------------------------------------------------------------------------
L.zonePx('goal', 184, 1108, 3.5, undefined, 'goal');

// --- hazards ------------------------------------------------------------------------------------
L.hazardPx(90, 400, { kind: 'steelie' });
L.hazardPx(150, 120, { kind: 'worm', range: 6 });
L.hazardPx(200, 150, { kind: 'worm', range: 5 });

export const stage2 = L.build();
