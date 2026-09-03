import { LevelBuilder } from '../engine/level';

/** BEGINNER RACE (arcade map stage2.png, 288x1160). First pass: main route only. */
const L = new LevelBuilder({
  id: 2, name: 'BEGINNER RACE', music: 'beginner', image: 'stages/stage2.png',
  width: 288, height: 1160, timeAdd: 65, carryTime: false,
});

// twin ramps from the plateau (z 100) to the lower floor (z -10); ramp A passes over ramp B
L.strip(214, 190, 100, 44, 372, -10, 2.8, 'rampA');
L.strip(120, 200, 100, 146, 234, 52, 2.8, 'rampB1');
L.strip(146, 234, 52, 218, 372, -10, 2.8, 'rampB');
// cone tents on the lower floor are solid
L.wallAt(123, 402, -10, 1.4, 1.4, 'coneM');
L.wallAt(35, 420, -10, 1.4, 1.4, 'coneL');
L.wallAt(211, 420, -10, 1.4, 1.4, 'coneR');
// staircase from the lower floor down-left to the mid floor (z -43)
const stairs = L.strip(170, 545, -10, 124, 600, -43, 2.4, 'stairs'); L.rails(stairs);
// pipe 1: funnel on the mid floor drops the marble onto the winding path below (z -140)
L.pipe({ u0: 0, v0: 0, u1: 0, v1: 0, exit: { u: 0, v: 0, vu: -3, vv: 3 }, duration: 1.6, bonus: 4000 });
const funnel = L.uv(245, 612, -43);
L.rect(funnel.u - 2.2, funnel.v - 2.2, funnel.u + 2.2, funnel.v + 2.2, -43, 0, 0, 'funnelFloor');
const pathExit = L.uv(204, 704, -140);
L.def.pipes[0] = { u0: funnel.u - 1.4, v0: funnel.v - 1.4, u1: funnel.u + 1.4, v1: funnel.v + 1.4, zMin: -60, zMax: -30,
  exit: { u: pathExit.u, v: pathExit.v, vu: -2, vv: 4 }, duration: 1.6, bonus: 4000 };
// second pipe (Y) from the path down to the teal floor (z -305): two inlets, one outlet
const yOut = L.uv(236, 892, -305);
for (const [ix, iy] of [[125, 803], [178, 786]] as const) {
  const yIn = L.uv(ix, iy, -140);
  L.rect(yIn.u - 2.2, yIn.v - 2.2, yIn.u + 2.2, yIn.v + 2.2, -140, 0, 0, 'inletFloor');
  L.pipe({ u0: yIn.u - 1.5, v0: yIn.v - 1.5, u1: yIn.u + 1.5, v1: yIn.v + 1.5, zMin: -160, zMax: -120,
    exit: { u: yOut.u, v: yOut.v, vu: 2, vv: 3 }, duration: 1.5, bonus: 2000 });
}
// ice slope from the teal floor down to the purple goal floor (z -395)
const ice = L.strip(232, 950, -305, 120, 1060, -395, 6, 'ice'); void ice;

// start / checkpoints
const start = L.uv(64, 70, 100);
L.start(start.u, start.v); L.checkpoint(start.u, start.v);
const c1 = L.uv(127, 430, -10); L.checkpoint(c1.u, c1.v); L.zone('checkpoint', c1.u - 8, c1.v - 8, c1.u + 8, c1.v + 8, 1, 'cp1', -20, 0);
const c2 = L.uv(228, 560, -43); L.checkpoint(c2.u, c2.v); L.zone('checkpoint', c2.u - 6, c2.v - 6, c2.u + 6, c2.v + 6, 2, 'cp2', -55, -30);
const c3 = L.uv(200, 720, -140); L.checkpoint(c3.u, c3.v); L.zone('checkpoint', c3.u - 4, c3.v - 4, c3.u + 4, c3.v + 4, 3, 'cp3', -150, -130);
const c4 = L.uv(240, 910, -305); L.checkpoint(c4.u, c4.v); L.zone('checkpoint', c4.u - 4, c4.v - 4, c4.u + 4, c4.v + 4, 4, 'cp4', -320, -290);
// the GOAL sign is painted over the floor: explicit floor under it
const signC = L.uv(150, 1094, -395); L.rect(signC.u - 3.5, signC.v - 3.5, signC.u + 3.5, signC.v + 3.5, -395, 0, 0, 'goalSign');
const goal = L.uv(184, 1108, -395);
L.zone('goal', goal.u - 3.5, goal.v - 3.5, goal.u + 3.5, goal.v + 3.5, undefined, 'goal', -410, -380);

// hazards
L.hazard({ kind: 'steelie', u: L.uv(90, 400, -10).u, v: L.uv(90, 400, -10).v });
L.hazard({ kind: 'worm', u: L.uv(150, 120, 100).u, v: L.uv(150, 120, 100).v, range: 6 });
L.hazard({ kind: 'worm', u: L.uv(200, 150, 100).u, v: L.uv(200, 150, 100).v, range: 5 });

export const stage2 = L.build();
