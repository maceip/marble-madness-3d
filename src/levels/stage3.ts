import { LevelBuilder } from '../engine/level';

/** INTERMEDIATE RACE (arcade map stage3.png, 288x1080). First pass: main route. */
const L = new LevelBuilder({
  id: 3, name: 'INTERMEDIATE RACE', music: 'intermediate', image: 'stages/stage3.png',
  width: 288, height: 1080, timeAdd: 35, carryTime: true,
});

// the central pit is fatal (its platforms are far below the maze)
{ const a = L.uv(150, 300, 40), b = L.uv(150, 380, 40); L.zone('kill', Math.min(a.u, b.u) - 6, Math.min(a.v, b.v) - 6, Math.max(a.u, b.u) + 6, Math.max(a.v, b.v) + 6, undefined, 'pit', -100, 80); }

// funnel pipe on the maze (z 100) drops the marble to the floors below (z -25)
const funnel = L.uv(162, 645, 100);
L.rect(funnel.u - 2.4, funnel.v - 2.4, funnel.u + 2.4, funnel.v + 2.4, 100, 0, 0, 'funnelFloor');
const pipeOut = L.uv(150, 752, -25);
L.pipe({ u0: funnel.u - 1.4, v0: funnel.v - 1.4, u1: funnel.u + 1.4, v1: funnel.v + 1.4, zMin: 88, zMax: 112,
  exit: { u: pipeOut.u, v: pipeOut.v, vu: 1, vv: 3 }, duration: 1.5, bonus: 2000 });

// bridge plate and the wave chutes down to the goal (approximated as straight strips)
L.band(64, 272, 812, 12, -40, 0, 0, 'plate');
L.strip(120, 880, -40, 60, 1000, -100, 3, 'waveL');
L.strip(210, 880, -40, 140, 1000, -100, 3, 'waveR');
L.strip(80, 1000, -100, 230, 1040, -120, 4, 'goalRun');
const signC = L.uv(232, 1036, -120); L.rect(signC.u - 3.5, signC.v - 3.5, signC.u + 3.5, signC.v + 3.5, -120, 0, 0, 'goalSign');

// start / checkpoints
const start = L.uv(146, 100, 100);
L.start(start.u, start.v); L.checkpoint(start.u, start.v);
const c1 = L.uv(150, 500, 100); L.checkpoint(c1.u, c1.v); L.zone('checkpoint', c1.u - 8, c1.v - 8, c1.u + 8, c1.v + 8, 1, 'cp1', 90, 110);
const c2 = L.uv(150, 760, -25); L.checkpoint(c2.u, c2.v); L.zone('checkpoint', c2.u - 5, c2.v - 5, c2.u + 5, c2.v + 5, 2, 'cp2', -40, -10);
const c3 = L.uv(160, 850, -40); L.checkpoint(c3.u, c3.v); L.zone('checkpoint', c3.u - 6, c3.v - 6, c3.u + 6, c3.v + 6, 3, 'cp3', -55, -25);
const goal = L.uv(232, 1036, -120);
L.zone('goal', goal.u - 3.5, goal.v - 3.5, goal.u + 3.5, goal.v + 3.5, undefined, 'goal', -135, -105);

// hazards: slimes at the pit ramp feet, a wand on the maze, worms on the lower maze
for (const [x, y] of [[40, 300], [235, 300], [120, 560]] as const) { const p = L.uv(x, y, 100); L.hazard({ kind: 'slime', u: p.u, v: p.v, range: 2 }); }
L.hazard({ kind: 'wand', u: 0, v: 0, band: [40, 120] });
{ const p = L.uv(200, 520, 100); L.hazard({ kind: 'worm', u: p.u, v: p.v, range: 5 }); }

export const stage3 = L.build();
