import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');

async function build() {
  console.log('[build] Bundling TypeScript with esbuild...');
  await esbuild.build({
    entryPoints: [resolve(root, 'src/main.ts')],
    bundle: true,
    outfile: resolve(root, 'www/bundle.js'),
    format: 'esm',
    sourcemap: true,
    minify: process.env.NODE_ENV === 'production',
    target: ['es2022'],
  });
  console.log('[build] Bundled successfully -> www/bundle.js');
}

build().catch((err) => {
  console.error('[build] Build error:', err);
  process.exit(1);
});
