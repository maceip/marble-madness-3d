// Bundle src/levels/index.ts with esbuild, import it, and write JSON for tools/level_overlay.py
import * as esbuild from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outDir = resolve(root, 'artifacts/levels');
mkdirSync(outDir, { recursive: true });
const tmp = resolve(outDir, '_levels_bundle.mjs');
await esbuild.build({
  entryPoints: [resolve(root, 'src/levels/index.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: tmp, target: ['es2022'], logLevel: 'warning',
});
const mod = await import(pathToFileURL(tmp).href + `?t=${Date.now()}`);
const stages = mod.STAGES;
for (const s of stages) {
  writeFileSync(resolve(outDir, `stage${s.id}.json`), JSON.stringify(s, null, 1));
  console.log(`stage${s.id}: ${s.surfaces.length} surfaces, ${s.zones.length} zones, ${s.hazards.length} hazards`);
}
