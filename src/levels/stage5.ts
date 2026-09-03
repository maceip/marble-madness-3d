import { LevelBuilder } from '../engine/level';

/** SILLY RACE (arcade map stage5.png, 288x1144) — starts at the bottom and climbs to the goal. */
const L = new LevelBuilder({
  id: 5, name: 'SILLY RACE', music: 'silly', image: 'stages/stage5.png',
  width: 288, height: 1144, timeAdd: 20, carryTime: true, progressDir: -1,
});

// climbs (the race goes up): bottom (100) -> X ramps -> plaza (177) -> green (201/235) -> orange (339) -> red (356) -> goal (385)
L.strip(40, 1005, 100, 146, 880, 177, 3, 'xRampL');
L.strip(250, 1005, 100, 146, 880, 177, 3, 'xRampR');
L.strip(84, 884, 177, 20, 718, 201, 4.5, 'plazaToGreen');
L.strip(60, 650, 201, 110, 600, 235, 3.2, 'climbA');
L.strip(110, 578, 235, 60, 520, 339, 3.2, 'climbB');
L.strip(270, 304, 339, 270, 268, 356, 3.2, 'climbC');
L.strip(150, 104, 356, 150, 62, 385, 3.2, 'climbD');

const start = L.uv(146, 1060, 100);
L.start(start.u, start.v); L.checkpoint(start.u, start.v);
// the plaza with little blocks hands out +3 SEC while the marble is on it
{ const a = L.uv(70, 770, 177), b = L.uv(230, 870, 177); L.zone('timezone', Math.min(a.u, b.u), Math.min(a.v, b.v), Math.max(a.u, b.u), Math.max(a.v, b.v), undefined, 'plaza', 165, 190); }
const c1 = L.uv(150, 820, 177); L.checkpoint(c1.u, c1.v); L.zone('checkpoint', c1.u - 6, c1.v - 6, c1.u + 6, c1.v + 6, 1, 'cp1', 165, 190);
const c2 = L.uv(160, 700, 201); L.checkpoint(c2.u, c2.v); L.zone('checkpoint', c2.u - 6, c2.v - 6, c2.u + 6, c2.v + 6, 2, 'cp2', 185, 250);
const c3 = L.uv(60, 440, 339); L.checkpoint(c3.u, c3.v); L.zone('checkpoint', c3.u - 6, c3.v - 6, c3.u + 6, c3.v + 6, 3, 'cp3', 325, 365);
const goalC = L.uv(150, 62, 385);
L.rect(goalC.u - 3.5, goalC.v - 3.5, goalC.u + 3.5, goalC.v + 3.5, 385, 0, 0, 'goalSign');
L.zone('bonus', goalC.u - 4, goalC.v - 4, goalC.u + 4, goalC.v + 4, 2000, 'goalflags', 370, 400);
L.zone('goal', goalC.u - 3.5, goalC.v - 3.5, goalC.u + 3.5, goalC.v + 3.5, undefined, 'goal', 370, 400);

// hazards: slimes on the plaza, birds over the tent field, wand on the green paths
for (const [x, y] of [[100, 800], [190, 810], [150, 845]] as const) { const p = L.uv(x, y, 177); L.hazard({ kind: 'slime', u: p.u, v: p.v, range: 2 }); }
L.hazard({ kind: 'birds', u: 0, v: 0, band: [40, 140], period: 7, count: 4 });
L.hazard({ kind: 'wand', u: 0, v: 0, band: [150, 260] });

export const stage5 = L.build();
