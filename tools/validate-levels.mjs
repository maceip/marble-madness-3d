// Offline course validator: compiles every course, prints the terrain map and
// fails on illegal height deltas. Run with `npm run validate`.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// node's type-stripping cannot resolve ".js" -> ".ts" specifiers, so mirror
// src/ into a temp dir with the specifiers rewritten (esbuild/tsc, which do
// resolve them, handle the real build).
const dir = mkdtempSync(join(tmpdir(), 'mml-levels-'));
try {
  execSync(`cp -r src/data/. "${dir}/" && cp -r src/lib/. "${dir}/"`, { stdio: 'inherit' });
  for (const f of execSync(`find "${dir}" -name '*.ts'`).toString().trim().split('\n')) {
    const s = readFileSync(f, 'utf8').replace(/from '(\.\.?\/[a-z-]+?)\.js'/g, "from '$1.ts'");
    writeFileSync(f, s);
  }

  const { renderTerrain } = await import(join(dir, 'build.ts'));
  const { LEVELS } = await import(join(dir, 'levels.ts'));

  let bad = 0;
  for (const lvl of LEVELS) {
    console.log(`\n=== ${lvl.def.name} (${lvl.def.theme}) ===`);
    console.log(renderTerrain(lvl));
    console.log('  props:', lvl.props.map((p) => `${p.kind}@${p.x - 0.5},${p.z - 0.5}`).join(' ') || 'none');
    if (lvl.problems.length) {
      bad += lvl.problems.length;
      for (const p of lvl.problems.slice(0, 60)) console.log('  !', p);
    }
  }
  if (bad) {
    console.error(`\n${bad} terrain problems found`);
    process.exit(1);
  }
  console.log('\nall courses compiled cleanly');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
