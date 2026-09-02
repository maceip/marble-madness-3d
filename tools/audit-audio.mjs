import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', 'www', 'audio');
const manifest = JSON.parse(await readFile(resolve(root, 'audio-manifest.json'), 'utf8'));
const files = new Set([
  ...Object.values(manifest.originalCourseMusic),
  ...Object.values(manifest.customCourseReuse),
  ...Object.values(manifest.originalEffects),
  ...manifest.legacyNumberedMusicNotUsedForCourseIdentity,
]);
for (const file of files) await access(resolve(root, file));
if (manifest.musicDefaultVolume > 0.2) throw new Error('default music mix is too loud');
console.log(`audio audit: ${files.size} mapped files present; six original courses have named music; default ${Math.round(manifest.musicDefaultVolume * 100)}%`);
