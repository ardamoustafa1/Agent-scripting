#!/usr/bin/env node
import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const [name, target] = process.argv.slice(2);
if (!name || !target || !/^[a-z][a-z0-9]*\.[a-z][a-zA-Z0-9]*$/.test(name))
  throw new Error('Usage: create-verbis-component vendor.componentName ./new-directory');
const destination = resolve(target),
  template = resolve(dirname(fileURLToPath(import.meta.url)), '../template');
// mkdir without recursive/exist_ok deliberately rejects existing directories; no overwrite.
// The directory it creates is empty, so the copy cannot overwrite anything (and newer Node
// versions reject `errorOnExist` when the destination directory already exists).
await mkdir(destination);
await cp(template, destination, { recursive: true, force: false });
for (const file of ['package.json', 'component.manifest.json', 'src/main.tsx']) {
  const path = resolve(destination, file);
  const contents = await readFile(path, 'utf8');
  await writeFile(
    path,
    contents
      .replaceAll('__COMPONENT_TYPE__', name)
      .replaceAll('__PACKAGE_NAME__', name.toLowerCase().replace('.', '-')),
  );
}
process.stdout.write(`Created ${name} in ${destination}\n`);
