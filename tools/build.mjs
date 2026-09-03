import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const watch = process.argv.includes('--watch');

const options = {
  entryPoints: [resolve(root, 'src/main.ts')],
  bundle: true,
  outfile: resolve(root, 'www/bundle.js'),
  format: 'esm',
  sourcemap: true,
  // one-shot builds ship minified; --watch stays readable. NODE_ENV was never set in deploy, so production used to go out fat.
  minify: !watch,
  target: ['es2022'],
  logLevel: 'info',
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
