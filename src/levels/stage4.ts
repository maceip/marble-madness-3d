import { LevelBuilder } from '../engine/level';

/** AERIAL RACE (arcade map stage4.png, 288x1024). First pass. */
const L = new LevelBuilder({
  id: 4, name: 'AERIAL RACE', music: 'aerial', image: 'stages/stage4.png',
  width: 288, height: 1024, timeAdd: 30, carryTime: true,
});

// pink floor (z 215) -> landing (191) -> long slide down to the green path (100); same on the yellow side
L.strip(86, 238, 191, 124, 300, 100, 3, 'slidePink');
L.strip(198, 254, 130, 186, 300, 100, 3, 'slideYellow');
// green path (100) down to the lower floors: left (15) and right (8)
L.strip(122, 640, 100, 96, 700, 15, 3, 'downLeft');
L.strip(176, 560, 100, 214, 660, 8, 3, 'downRight');
// lower floors down to the blue floor (-80) and the goal sign (-112)
L.strip(110, 790, 15, 112, 848, -80, 3, 'toBlueL');
L.strip(206, 732, 8, 206, 756, -80, 3, 'toBlueR');
L.strip(86, 950, -80, 86, 998, -112, 3, 'toGoal');

const start = L.uv(60, 215, 215);
L.start(start.u, start.v); L.checkpoint(start.u, start.v);
const c1 = L.uv(100, 300, 100); L.checkpoint(c1.u, c1.v); L.zone('checkpoint', c1.u - 6, c1.v - 6, c1.u + 6, c1.v + 6, 1, 'cp1', 90, 110);
const c2 = L.uv(160, 540, 100); L.checkpoint(c2.u, c2.v); L.zone('checkpoint', c2.u - 6, c2.v - 6, c2.u + 6, c2.v + 6, 2, 'cp2', 90, 110);
const c3 = L.uv(150, 700, 15); L.checkpoint(c3.u, c3.v); L.zone('checkpoint', c3.u - 6, c3.v - 6, c3.u + 6, c3.v + 6, 3, 'cp3', 0, 30);
const c4 = L.uv(180, 890, -80); L.checkpoint(c4.u, c4.v); L.zone('checkpoint', c4.u - 6, c4.v - 6, c4.u + 6, c4.v + 6, 4, 'cp4', -95, -65);
const signC = L.uv(88, 972, -112); L.rect(signC.u - 3.5, signC.v - 3.5, signC.u + 3.5, signC.v + 3.5, -112, 0, 0, 'goalSign');
L.zone('bonus', signC.u - 4, signC.v - 4, signC.u + 4, signC.v + 4, 4000, 'goalflags', -130, -95);
L.zone('goal', signC.u - 3.5, signC.v - 3.5, signC.u + 3.5, signC.v + 3.5, undefined, 'goal', -130, -95);

// hazards (from the review clips): vacuum boxes on the upper zigzag path, riser pads on the disc
// fields (pistons pop in a wave; one rising under you catapults you along the launch direction),
// rotating hammers by the goal run, a steelie on the lower floor
for (const [x, y, f] of [[135, 330, 1], [210, 420, -1], [95, 505, 1]] as const) { const p = L.uv(x, y, 100); L.hazard({ kind: 'vacuum', u: p.u, v: p.v, range: 3.2, facing: f }); }
for (const [x, y, du, dv] of [[27, 515, 3, -1], [91, 567, 3, -1], [123, 639, 1, 3], [165, 553, 3, 1]] as const) {
  const p = L.uv(x, y, 100); L.hazard({ kind: 'risers', u: p.u, v: p.v, size: [3, 3], period: 3.2, phase: Math.random() * 3, launch: { du, dv } });
}
for (const [x, y, f] of [[150, 930, 1], [205, 905, -1]] as const) { const p = L.uv(x, y, -80); L.hazard({ kind: 'hammer', u: p.u, v: p.v, period: 2.4, phase: Math.random() * 2, facing: f }); }
{ const p = L.uv(200, 700, 8); L.hazard({ kind: 'steelie', u: p.u, v: p.v }); }

export const stage4 = L.build();
