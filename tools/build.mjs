import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, copyFile, unlink, rm } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const watch = process.argv.includes('--watch');

// Dynamic agent-runtime chunks are content hashed. Remove the previous generated set so a deploy never
// accumulates dead multi-megabyte chunks; the current build recreates exactly the files bundle.js imports.
await rm(resolve(root, 'www/chunks'), { recursive: true, force: true });

// Collision assets (stageN.labels.png + stageN.comps.json) ship under content-hashed names. The bundle asks
// for exactly the revision it was built with, so a stale copy on the server or in an HTTP cache
// (public, max-age=3600 on .json/.png) can never pair old geometry with new code.
const stagesDir = resolve(root, 'www/assets/stages');
const collisionRev = {};
{
  const files = await readdir(stagesDir);
  const stale = files.filter((f) => /^stage\d+\.[0-9a-f]{10}\.(comps\.json|labels\.png)$/.test(f));
  for (const f of files) {
    const m = f.match(/^(stage\d+)\.comps\.json$/);
    if (!m) continue;
    const base = m[1];
    const comps = await readFile(resolve(stagesDir, `${base}.comps.json`));
    const labels = await readFile(resolve(stagesDir, `${base}.labels.png`));
    const rev = createHash('sha256').update(comps).update(labels).digest('hex').slice(0, 10);
    collisionRev[`stages/${base}`] = rev;
    for (const [src, ext] of [[comps, 'comps.json'], [labels, 'labels.png']]) {
      const name = `${base}.${rev}.${ext}`;
      if (!files.includes(name)) await writeFile(resolve(stagesDir, name), src);
      const i = stale.indexOf(name); if (i >= 0) stale.splice(i, 1);
    }
  }
  for (const f of stale) await unlink(resolve(stagesDir, f));
  console.log(`[build] collision assets: ${Object.entries(collisionRev).map(([k, v]) => `${k.replace('stages/', '')}@${v}`).join(' ')}`);
}

const options = {
  entryPoints: [resolve(root, 'src/main.ts')],
  bundle: true,
  outdir: resolve(root, 'www'),
  entryNames: 'bundle',
  chunkNames: 'chunks/[name]-[hash]',
  splitting: true,
  format: 'esm',
  sourcemap: true,
  // one-shot builds ship minified; --watch stays readable. NODE_ENV was never set in deploy, so production used to go out fat.
  minify: !watch,
  target: ['es2022'],
  logLevel: 'info',
  define: { __MM_COLLISION_REV__: JSON.stringify(collisionRev) },
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('[build] watching src/ ...');
} else {
  await esbuild.build(options);
  const bundle = await readFile(resolve(root, 'www/bundle.js'));
  const revision = createHash('sha256').update(bundle).digest('hex').slice(0, 16);
  const template = await readFile(resolve(root, 'tools/sw.template.js'), 'utf8');
  await writeFile(resolve(root, 'www/sw.js'), template.replaceAll('__MM_REVISION__', revision));
  console.log('[build] www/bundle.js written');
  console.log(`[build] www/sw.js written (${revision})`);
}
