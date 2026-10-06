import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
const bundle = await readFile('dist/component.js'),
  manifest = JSON.parse(await readFile('component.manifest.json', 'utf8'));
manifest.integrity = `sha384-${createHash('sha384').update(bundle).digest('base64')}`;
await writeFile('dist/component.manifest.json', JSON.stringify(manifest, null, 2) + '\n');
