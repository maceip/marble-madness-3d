import { LevelBuilder } from '../engine/level';

/**
 * ULTIMATE RACE (arcade map stage6.png, 288x864) -- floating islands in space.
 *
 * Collision is the art-derived heightfield built by tools/author_stage.py from
 * tools/stage_specs/stage6.json. The route drops from the z100 start course to
 * the glass course at z65, then down the measured 64 px faces to z1 and
 * z-63 before the final 64 px drop to the goal level at z-127.
 */
const L = new LevelBuilder({
  id: 6, name: 'ULTIMATE RACE', music: 'ultimate', image: 'stages/stage6.png',
  width: 288, height: 864, timeAdd: 20, carryTime: true,
});

// The opening white chute is scripted so both players begin from the real start rather than
// being steered across its rim while the race intro releases the marbles.
const towerSlide = L.slide([[120, 96, 100], [113, 105, 100], [106, 114, 100], [120, 130, 96], [142, 145, 90], [162, 158, 85]]);
L.startPx(120, 96, towerSlide);
L.start2Px(126, 96, towerSlide);
L.checkpointPx(120, 96);

// Route checkpoints and bonuses.
L.checkpointPx(150, 300, { r: 6, value: 1, id: 'cp1' });
L.zonePx('bonus', 150, 300, 3, 2000, 'glassBonus');
L.checkpointPx(150, 520, { r: 6, value: 2, id: 'cp2' });
L.zonePx('bonus', 156, 706, 4, 6000, 'goalflags');
L.zonePx('goal', 156, 706, 3.5, undefined, 'goal');

// Hazards: steelie on the blue floor, slime on the orange floor, birds over the middle,
// and shifting tiles at the goal.
L.hazardPx(147, 619, { kind: 'steelie' });
L.hazardPx(60, 340, { kind: 'slime', range: 2 });
L.hazard({ kind: 'birds', u: 0, v: 0, band: [60, 200], period: 8, count: 4 });
L.hazardPx(156, 706, { kind: 'shifting' });

export const stage6 = L.build();
