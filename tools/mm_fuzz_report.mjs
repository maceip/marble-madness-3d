#!/usr/bin/env node
/**
 * mm_fuzz_report.mjs — rank the incidents written by tools/mm_fuzz.mjs into spots to look at.
 *
 *   node tools/mm_fuzz_report.mjs [stage] [--cell 12] [--top 25] [--dir artifacts/fuzz]
 *
 * Deaths are attributed to the last grounded pixel (where the marble left the floor), stalls to where it
 * stood. Incidents are bucketed into cell x cell map-pixel squares and sorted by count. Each row shows the
 * bucket centre, counts by type, and the most common reason strings, so a fixer can open the stage picture
 * at that pixel and decide: real edge / real wall (fine) or a collision defect (fix the spec).
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const only = args[0] && !args[0].startsWith('--') ? parseInt(args[0], 10) : null;
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const CELL = parseInt(opt('cell', '12'), 10), TOP = parseInt(opt('top', '25'), 10);
const dir = path.resolve(opt('dir', 'artifacts/fuzz'));

const recs = [];
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
  for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { recs.push(JSON.parse(line)); } catch {}
  }
}
const stages = [...new Set(recs.map((r) => r.stage))].filter((s) => only === null || s === only).sort();
for (const st of stages) {
  const rs = recs.filter((r) => r.stage === st);
  const sums = rs.filter((r) => r.ev === 'summary');
  const tot = sums.reduce((a, s) => ({ ep: a.ep + s.episodes, sec: a.sec + s.seconds, d: a.d + s.deaths, st: a.st + s.stalls, sk: a.sk + s.sinks }), { ep: 0, sec: 0, d: 0, st: 0, sk: 0 });
  console.log(`\n=== STAGE ${st}: ${sums.length} workers, ${tot.ep} episodes, ${(tot.sec / 60).toFixed(0)} marble-minutes; deaths ${tot.d}, stalls ${tot.st}, sinks ${tot.sk}`);
  const buckets = new Map();
  for (const r of rs) {
    if (!['die', 'stall', 'sink'].includes(r.ev)) continue;
    const px = r.ev === 'die' && r.from ? r.from : r;
    if (px.sx === undefined) continue;
    const k = `${Math.floor(px.sx / CELL)},${Math.floor(px.sy / CELL)}`;
    let b = buckets.get(k);
    if (!b) { b = { k, n: 0, die: 0, stall: 0, sink: 0, sus: 0, sx: 0, sy: 0, z: [], why: new Map(), headings: [] }; buckets.set(k, b); }
    b.n++; b[r.ev]++; if (r.suspect || r.ev === 'sink' || r.ev === 'stall') b.sus++; b.sx += px.sx; b.sy += px.sy; b.z.push(px.z);
    const why = r.ev === 'die' ? (r.why || '').replace(/airT=[\d.]+ /, '').replace(/ at [\d.,-]+ z[\d.-]+/g, '') : (r.blocks || r.why || '');
    b.why.set(why, (b.why.get(why) || 0) + 1);
    if (r.route) b.headings.push(r.route.heading);
  }
  const rows = [...buckets.values()].sort((a, b) => (b.sus - a.sus) || (b.n - a.n)).slice(0, TOP);
  const susTotal = [...buckets.values()].reduce((a, b) => a + b.sus, 0);
  console.log(`suspect incidents (drawn floor ahead of a death, a sink, or a stall): ${susTotal}; legit-looking edge deaths are ranked below them`);
  console.log(`spot  px        z     n  SUS die stall sink  route   reason`);
  for (const b of rows) {
    const z = Math.round(b.z.reduce((a, c) => a + c, 0) / b.z.length);
    const why = [...b.why.entries()].sort((a, c) => c[1] - a[1]).slice(0, 2).map(([w, n]) => `${w} x${n}`).join(' ; ');
    const hd = b.headings.length ? `${Math.round(b.headings.reduce((a, c) => a + c, 0) / b.headings.length)}°` : '';
    console.log(`${b.k.padEnd(6)} (${Math.round(b.sx / b.n)},${Math.round(b.sy / b.n)})`.padEnd(18) + `${String(z).padStart(5)} ${String(b.n).padStart(4)} ${String(b.sus).padStart(4)} ${String(b.die).padStart(4)} ${String(b.stall).padStart(5)} ${String(b.sink).padStart(4)}  ${hd.padEnd(6)}  ${why.slice(0, 110)}`);
  }
  const errs = rs.filter((r) => r.ev === 'pageerror' || r.ev === 'abort');
  if (errs.length) console.log(`page errors / aborts: ${errs.length}: ${errs.slice(0, 3).map((e) => e.why).join(' | ').slice(0, 300)}`);
}
