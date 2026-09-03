import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const watch = process.argv.includes('--watch');

const options = {
  entryPoints: [resolve(root, 'src/main.ts')],
  bundle: true,
  outfile: resolve(root, 'www/bundle.js'),
  format: 'esm',
  sourcemap: true,
  minify: process.env.NODE_ENV === 'production',
  target: ['es2022'],
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('[build] watching src/ ...');
} else {
  await esbuild.build(options);
  console.log('[build] www/bundle.js written');
}
