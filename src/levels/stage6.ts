import { LevelBuilder } from '../engine/level';

/** ULTIMATE RACE (arcade map stage6.png, 288x864) — floating islands in space. First pass. */
const L = new LevelBuilder({
  id: 6, name: 'ULTIMATE RACE', music: 'ultimate', image: 'stages/stage6.png',
  width: 288, height: 864, timeAdd: 20, carryTime: true,
});

const start = L.uv(120, 96, 100);
L.start(start.u, start.v); L.checkpoint(start.u, start.v);
// glass bridges (cyan) are not floor coloured: explicit strips
L.strip(60, 236, 65, 96, 276, 65, 2.4, 'glassA');
L.strip(136, 270, 65, 170, 316, 65, 2.4, 'glassB');
const c1 = L.uv(150, 300, 65); L.checkpoint(c1.u, c1.v); L.zone('checkpoint', c1.u - 6, c1.v - 6, c1.u + 6, c1.v + 6, 1, 'cp1', 50, 80);
L.zone('bonus', c1.u - 3, c1.v - 3, c1.u + 3, c1.v + 3, 2000, 'glassBonus', 50, 80);
const c2 = L.uv(150, 520, -124); L.checkpoint(c2.u, c2.v); L.zone('checkpoint', c2.u - 6, c2.v - 6, c2.u + 6, c2.v + 6, 2, 'cp2', -140, -110);
const goalC = L.uv(156, 706, -277);
L.rect(goalC.u - 3.5, goalC.v - 3.5, goalC.u + 3.5, goalC.v + 3.5, -277, 0, 0, 'goalSign');
L.zone('bonus', goalC.u - 4, goalC.v - 4, goalC.u + 4, goalC.v + 4, 6000, 'goalflags', -292, -262);
L.zone('goal', goalC.u - 3.5, goalC.v - 3.5, goalC.u + 3.5, goalC.v + 3.5, undefined, 'goal', -292, -262);

// hazards: steelie on the blue floor, slimes on the orange floor, birds over the middle
{ const p = L.uv(150, 600, -188); L.hazard({ kind: 'steelie', u: p.u, v: p.v, z: p.z }); }
{ const p = L.uv(60, 340, 16); L.hazard({ kind: 'slime', u: p.u, v: p.v, z: p.z, range: 2 }); }
L.hazard({ kind: 'birds', u: 0, v: 0, band: [60, 200], period: 8, count: 4 });

export const stage6 = L.build();
