import { LevelBuilder } from '../engine/level';

/** INTERMEDIATE RACE (arcade map stage3.png, 288x1080). First pass: main route. */
const L = new LevelBuilder({
  id: 3, name: 'INTERMEDIATE RACE', music: 'intermediate', image: 'stages/stage3.png',
  width: 288, height: 1080, timeAdd: 35, carryTime: true,
});

// the central pit is fatal (its platforms are far below the maze)
{ const a = L.uv(150, 300, 40), b = L.uv(150, 380, 40); L.zone('kill', Math.min(a.u, b.u) - 6, Math.min(a.v, b.v) - 6, Math.max(a.u, b.u) + 6, Math.max(a.v, b.v) + 6, undefined, 'pit', -100, 80); }

// funnel pipe on the maze (z 100) drops the marble to the floors below (z 60)
const funnel = L.uv(162, 645, 100);
L.rect(funnel.u - 2.4, funnel.v - 2.4, funnel.u + 2.4, funnel.v + 2.4, 100, 0, 0, 'funnelFloor');
const pipeOut = L.uv(152, 768, 60);
L.pipe({ u0: funnel.u - 1.4, v0: funnel.v - 1.4, u1: funnel.u + 1.4, v1: funnel.v + 1.4, zMin: 88, zMax: 112,
  exit: { u: pipeOut.u, v: pipeOut.v, z: 60, vu: 1.5, vv: 1.5 }, duration: 1.5, bonus: 2000 });

// bridge plate and the wave chutes down to the goal (z 60 down to 40)
const plate = L.band(64, 272, 812, 12, 60, 0, 0, 'plate');
{ const a = L.uv(64, 836, 60), b = L.uv(272, 888, 60); L.hazard({ kind: 'wave', u: (a.u + b.u) / 2, v: (a.v + b.v) / 2, period: 2.6, rect: { u0: Math.min(a.u, b.u), v0: Math.min(a.v, b.v) - 4, u1: Math.max(a.u, b.u), v1: Math.max(a.v, b.v) + 4 } }); }
void plate;
const signC = L.uv(232, 1036, 40); L.rect(signC.u - 3.5, signC.v - 3.5, signC.u + 3.5, signC.v + 3.5, 40, 0, 0, 'goalSign');

// --- the two towers and starting ramps (arcade: 2player_longplay.mov t=55-63) --------------------
// P1 (blue) starts on the LEFT tower top and slides down to the left maze platform (z 100);
// P2 (red) starts on the RIGHT tower top and slides down to the right maze platform (z 100).
const TOWER_Z = 210;
{
  const tl = L.uv(45, 52, TOWER_Z); L.rect(tl.u - 3, tl.v - 3, tl.u + 3, tl.v + 3, TOWER_Z, 0, 0, 'towerL');
  const tr = L.uv(243, 52, TOWER_Z); L.rect(tr.u - 3, tr.v - 3, tr.u + 3, tr.v + 3, TOWER_Z, 0, 0, 'towerR');
}
const rampFromLeft = L.slide([[45, 52, TOWER_Z], [58, 62, TOWER_Z], [72, 85, 180], [84, 110, 150], [91, 132, 130], [94, 150, 100]]);
const rampFromRight = L.slide([[243, 52, TOWER_Z], [230, 62, TOWER_Z], [216, 85, 180], [204, 110, 150], [197, 132, 130], [194, 150, 100]]);

// start / checkpoints
const start = L.uv(45, 52, TOWER_Z);
L.start(start.u, start.v, TOWER_Z, rampFromLeft); L.checkpoint(start.u, start.v);
const start2 = L.uv(243, 52, TOWER_Z);
L.start2(start2.u, start2.v, TOWER_Z, rampFromRight);
const c1 = L.uv(150, 500, 100); L.checkpoint(c1.u, c1.v); L.zone('checkpoint', c1.u - 8, c1.v - 8, c1.u + 8, c1.v + 8, 1, 'cp1', 90, 110);
const c2 = L.uv(150, 760, 60); L.checkpoint(c2.u, c2.v); L.zone('checkpoint', c2.u - 5, c2.v - 5, c2.u + 5, c2.v + 5, 2, 'cp2', 45, 75);
const c3 = L.uv(160, 850, 40); L.checkpoint(c3.u, c3.v); L.zone('checkpoint', c3.u - 6, c3.v - 6, c3.u + 6, c3.v + 6, 3, 'cp3', 25, 55);
const goal = L.uv(232, 1036, 40);
L.zone('goal', goal.u - 3.5, goal.v - 3.5, goal.u + 3.5, goal.v + 3.5, undefined, 'goal', 25, 55);

// hazards: slimes at the pit ramp feet, a wand on the maze, worms on the lower maze
for (const [x, y] of [[60, 330], [220, 330], [120, 560]] as const) { const p = L.uv(x, y, 100); L.hazard({ kind: 'slime', u: p.u, v: p.v, z: p.z, range: 2 }); }
L.hazard({ kind: 'wand', u: 0, v: 0, band: [40, 120] });
{ const p = L.uv(200, 520, 100); L.hazard({ kind: 'worm', u: p.u, v: p.v, z: p.z, range: 5 }); }

export const stage3 = L.build();
