import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

// The API loads packages through an ESM instrumentation hook that drops a name exported from two
// modules of the index, even when both refer to the same binding. Each public name has one home.
it('exports every public name from exactly one module of the index', () => {
  const dir = fileURLToPath(new URL('.', import.meta.url));
  const index = readFileSync(`${dir}index.ts`, 'utf8');
  const modules = [...index.matchAll(/export \* from '\.\/(.+)\.js';/g)].map((m) => m[1] ?? '');
  const owners = new Map<string, string[]>();
  for (const name of modules) {
    if (!readdirSync(dir).includes(`${name}.ts`)) continue;
    const source = readFileSync(`${dir}${name}.ts`, 'utf8');
    const declared = [
      ...source.matchAll(
        /^export (?:declare )?(?:async )?(?:function|const|class|let|type|interface|enum) ([A-Za-z0-9_]+)/gm,
      ),
    ].map((m) => m[1] ?? '');
    const reexported = [...source.matchAll(/^export \{([^}]+)\}/gm)].flatMap((m) =>
      (m[1] ?? '').split(',').map(
        (part) =>
          part
            .trim()
            .split(/\s+as\s+/)
            .at(-1) ?? '',
      ),
    );
    for (const exported of [...declared, ...reexported].filter(Boolean))
      owners.set(exported, [...(owners.get(exported) ?? []), name]);
  }
  expect([...owners].filter(([, from]) => from.length > 1)).toEqual([]);
  expect(owners.get('children')).toEqual(['parser']);
});
