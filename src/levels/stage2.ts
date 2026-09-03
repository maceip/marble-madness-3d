import { LevelBuilder } from '../engine/level';

/** BEGINNER RACE (arcade map stage2.png, 288x1160). First pass: main route only. */
const L = new LevelBuilder({
  id: 2, name: 'BEGINNER RACE', music: 'beginner', image: 'stages/stage2.png',
  width: 288, height: 1160, timeAdd: 65, carryTime: false,
});

// Ramp A: continuous 3D sloped bridge crossing over the lower ramp (plateau z=180 down to lower floor z=150)
const ra1 = L.rect(57.5, 31.5, 63.5, 41.5, 181.8, 0, -1.021, 'rampA_1'); L.rails(ra1, 0.8, 24);
const ra2 = L.rect(59.5, 39.5, 65.5, 49.5, 173.7, 0, -1.021, 'rampA_2'); L.rails(ra2, 0.8, 24);
const ra3 = L.rect(61.5, 47.5, 67.5, 57.5, 165.5, 0, -1.021, 'rampA_3'); L.rails(ra3, 0.8, 24);
const ra4 = L.rect(63.5, 55.5, 69.5, 63.5, 157.3, 0, -1.021, 'rampA_4'); L.rails(ra4, 0.8, 24);

// cone tents on the lower floor are solid
L.wallAt(123, 402, 150, 1.4, 1.4, 'coneM');
L.wallAt(35, 420, 150, 1.4, 1.4, 'coneL');
L.wallAt(211, 420, 150, 1.4, 1.4, 'coneR');
// pipe 1: funnel on the mid floor drops the marble onto the winding path below (z 89)
const funnel = L.uv(245, 612, 100);
L.rect(funnel.u - 3.6, funnel.v - 3.6, funnel.u + 3.6, funnel.v + 3.6, 100, 0, 0, 'funnelFloor');
const pathExit = L.uv(200, 712, 89);
L.pipe({ u0: funnel.u - 2, v0: funnel.v - 2, u1: funnel.u + 2, v1: funnel.v + 2, zMin: 80, zMax: 110,
  exit: { u: pathExit.u, v: pathExit.v, z: 89, vu: 0.5, vv: 1.5 }, duration: 1.6, bonus: 4000 });
// second pipe (Y) from the path down to the teal floor (z 70): two inlets, one outlet
const yOut = L.uv(236, 892, 70);
for (const [ix, iy] of [[125, 803], [178, 786]] as const) {
  const yIn = L.uv(ix, iy, 89);
  L.rect(yIn.u - 2.2, yIn.v - 2.2, yIn.u + 2.2, yIn.v + 2.2, 89, 0, 0, 'inletFloor');
  L.pipe({ u0: yIn.u - 1.5, v0: yIn.v - 1.5, u1: yIn.u + 1.5, v1: yIn.v + 1.5, zMin: 75, zMax: 100,
    exit: { u: yOut.u, v: yOut.v, z: 70, vu: 2, vv: 3 }, duration: 1.5, bonus: 2000 });
}

// start / checkpoints: authentic arcade spawn
// P1 on the open plateau floor (z=180); P2 in the top saucer depression (184, 30, z=180)
const start = L.uv(105, 80, 180);
L.start(start.u, start.v, 180); L.checkpoint(start.u, start.v);
const start2 = L.uv(184, 30, 180);
L.start2(start2.u, start2.v, 180);
const c1 = L.uv(127, 430, 150); L.checkpoint(c1.u, c1.v); L.zone('checkpoint', c1.u - 8, c1.v - 8, c1.u + 8, c1.v + 8, 1, 'cp1', 140, 160);
const c2 = L.uv(228, 560, 100); L.checkpoint(c2.u, c2.v); L.zone('checkpoint', c2.u - 6, c2.v - 6, c2.u + 6, c2.v + 6, 2, 'cp2', 90, 110);
const c3 = L.uv(200, 720, 89); L.checkpoint(c3.u, c3.v); L.zone('checkpoint', c3.u - 4, c3.v - 4, c3.u + 4, c3.v + 4, 3, 'cp3', 75, 100);
const c4 = L.uv(240, 910, 70); L.checkpoint(c4.u, c4.v); L.zone('checkpoint', c4.u - 4, c4.v - 4, c4.u + 4, c4.v + 4, 4, 'cp4', 60, 85);
// the GOAL sign is painted over the floor: explicit floor under it
const signC = L.uv(150, 1094, 40); L.rect(signC.u - 3.5, signC.v - 3.5, signC.u + 3.5, signC.v + 3.5, 40, 0, 0, 'goalSign');
const goal = L.uv(184, 1108, 40);
L.zone('goal', goal.u - 3.5, goal.v - 3.5, goal.u + 3.5, goal.v + 3.5, undefined, 'goal', 25, 55);

// hazards
L.hazard({ kind: 'steelie', u: L.uv(90, 400, 150).u, v: L.uv(90, 400, 150).v, z: 150 });
L.hazard({ kind: 'worm', u: L.uv(150, 120, 100).u, v: L.uv(150, 120, 100).v, z: 100, range: 6 });
L.hazard({ kind: 'worm', u: L.uv(200, 150, 100).u, v: L.uv(200, 150, 100).v, z: 100, range: 5 });

export const stage2 = L.build();
