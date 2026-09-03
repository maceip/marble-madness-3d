// Production-only: roll a marble down Practice's authored ramps. Fail if it
// goes airborne for long or voids. Also probes corner-cut dizzy.
//   BASE=https://marbles.secure.build node tools/test_ramps.mjs
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'https://marbles.secure.build';
if (/^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0)(:|\/|$)/i.test(BASE)) {
  console.error('refusing local HTTP; set BASE to https://marbles.secure.build');
  process.exit(2);
}

const RAMPS = [
  { id: 'side_ramps', from: [40, 110, 130], to: [40, 200, 100], steer: [0, 0.9], secs: 2.6 },
  { id: 'chute', from: [166, 300, 100], to: [170, 430, 50], steer: [0, 0.9], secs: 2.8 },
  { id: 'goal_corridor', from: [120, 490, 40], to: [40, 538, 38], steer: [-0.75, 0.45], secs: 3.0 },
];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
await page.goto(BASE + '/', { waitUntil: 'load' });
await page.waitForFunction(() => window.game && typeof window.game.newGame === 'function', null, { timeout: 20000 });
await page.evaluate(() => {
  window.game.sound.init();
  window.game.playerName = 'ACE';
  window.game.mode = '1p';
  window.game.newGame(0);
});
await page.waitForFunction(() => window.game.stage && window.game.stage.heightmap, null, { timeout: 15000 });
await page.evaluate(() => {
  // skip intro clock-in: Practice starts with timeLeft=0, which gameOvers before any step
  window.game.timeLeft = 120;
  window.game.paused = false;
  window.game.finished = false;
  window.game.marble.slide = null;
  window.game.go('race');
});
await page.waitForFunction(() => window.game.screen === 'race', null, { timeout: 8000 });

let fails = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) fails++;
};

const slopes = await page.evaluate(() => {
  const hm = window.game.stage.heightmap;
  return (hm?.comps || []).filter((c) => c.kind === 'slope').length;
});
check('Practice heightmap has slope components', slopes > 0, `n=${slopes}`);

for (const r of RAMPS) {
  const result = await page.evaluate(async ({ from, to, steer, secs }) => {
    const g = window.game;
    const toWorld = (x, y, z) => {
      const S = (y + z) / 4, D = x / 8;
      return { u: (S + D) / 2, v: (S - D) / 2, z };
    };
    const a = toWorld(...from), b = toWorld(...to);
    g.timeLeft = 120;
    g.paused = false;
    g.finished = false;
    g.marble.slide = null;
    g.marble.place(a.u, a.v, a.z + 2);
    g.marble.grounded = false;
    g.marble.vz = 0;
    g.update(1 / 60); // snap onto support
    const startSup = g.marble.support?.s?.name || null;
    const startZ = g.marble.z;
    g.marble.dizzyT = 0;
    g.marble.cornerTrip = false;
    const orig = g.input.sample.bind(g.input);
    g.input.sample = () => ({ ax: steer[0], ay: steer[1] });
    let air = 0, airMax = 0, voided = false, finished = false, frames = 0;
    const dt = 1 / 60;
    const n = Math.round(secs / dt);
    for (let i = 0; i < n; i++) {
      g.update(dt);
      frames++;
      if (g.goalReached || g.screen === 'timebonus' || g.screen === 'congrats') { finished = true; break; }
      if (g.screen !== 'race') { voided = true; break; }
      if (g.marble.phase !== 'alive') { voided = true; break; }
      if (!g.marble.grounded) { air += dt; airMax = Math.max(airMax, air); } else air = 0;
    }
    g.input.sample = orig;
    const du = g.marble.u - b.u, dv = g.marble.v - b.v;
    return {
      voided, finished, airMax, z: g.marble.z, z0: startZ, dist: Math.hypot(du, dv),
      grounded: g.marble.grounded, phase: g.marble.phase, frames,
      screen: g.screen, support: g.marble.support?.s?.name || null, startSup,
    };
  }, r);
  const drop = r.from[2] - result.z;
  const needDrop = Math.max(1, (r.from[2] - r.to[2]) * 0.35);
  const ok = result.finished || (!result.voided && result.airMax < 0.34
    && (result.phase === 'alive' || result.finished) && drop >= needDrop);
  check(`ramp ${r.id} stays on the band`, ok,
    `airMax=${result.airMax.toFixed(2)} z=${result.z0.toFixed(0)}→${result.z.toFixed(0)} drop=${drop.toFixed(1)} need≥${needDrop.toFixed(0)} void=${result.voided} sup=${result.support}`);
}

const dizzy = await page.evaluate(() => {
  const g = window.game;
  const hm = g.stage.heightmap;
  g.timeLeft = 120;
  g.paused = false;
  g.finished = false;
  g.marble.slide = null;
  const toWorld = (x, y, z) => {
    const S = (y + z) / 4, D = x / 8;
    return { u: (S + D) / 2, v: (S - D) / 2, z };
  };
  const floorAt = (x, y) => hm.floorPixel(x, y);
  // chute switchbacks: find a 3-on/1-off 2×2 and step into the empty cell
  let cut = null;
  for (let y = 300; y < 450 && !cut; y++) {
    for (let x = 110; x < 220; x++) {
      const bits = [floorAt(x, y), floorAt(x + 1, y), floorAt(x, y + 1), floorAt(x + 1, y + 1)];
      const n = bits.filter(Boolean).length;
      if (n !== 3) continue;
      const cells = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]];
      const emptyI = bits.findIndex((b) => !b);
      const floorI = bits.findIndex((b) => b);
      const [fx, fy] = cells[floorI];
      const [ox, oy] = cells[emptyI];
      const id = hm.labels[fy * hm.width + fx];
      const comp = hm.comps.find((c) => c.id === id);
      const guess = toWorld(fx, fy, 70);
      const z = comp ? hm.zOf(comp, guess.u, guess.v) : 70;
      cut = { from: toWorld(fx, fy, z), empty: toWorld(ox, oy, z), map: [fx, fy, ox, oy] };
      break;
    }
  }
  if (!cut) return { sawDizzy: false, tripped: false, reason: 'no-corner' };
  g.marble.place(cut.from.u, cut.from.v, cut.from.z + 8);
  g.marble.cornerTrip = false;
  g.marble.dizzyT = 0;
  const du = cut.empty.u - cut.from.u, dv = cut.empty.v - cut.from.v;
  const orig = g.input.sample.bind(g.input);
  g.input.sample = () => ({ ax: Math.sign(du - dv) || 0.4, ay: Math.sign(du + dv) || 0.4 });
  let sawDizzy = false, tripped = false, air = false;
  for (let i = 0; i < 120; i++) {
    g.update(1 / 60);
    if (!g.marble.grounded) air = true;
    if (g.marble.cornerTrip) tripped = true;
    if (g.marble.dizzyT > 0) { sawDizzy = true; break; }
    if (g.marble.phase !== 'alive') break;
  }
  g.input.sample = orig;
  return {
    sawDizzy, tripped, air, dizzyT: g.marble.dizzyT, phase: g.marble.phase,
    corner: g.marble.cornerTrip, map: cut.map, near: hm.nearPathCorner(cut.from.u, cut.from.v, cut.from.z),
  };
});
check('corner-cut sets dizzy (or cornerTrip)', dizzy.sawDizzy || dizzy.tripped,
  JSON.stringify(dizzy));

await browser.close();
console.log(fails ? `\nRAMPS: FAIL (${fails})` : '\nRAMPS: PASS');
process.exit(fails ? 1 : 0);
