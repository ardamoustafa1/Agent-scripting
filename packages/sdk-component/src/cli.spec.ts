// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';

import { describe, expect, it } from 'vitest';

describe('create-verbis-component CLI', () => {
  it('generates a translated standalone scaffold and refuses overwrites', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'verbis-component-'));
    const destination = join(parent, 'plugin');
    const cli = resolve('cli/create.mjs');
    try {
      execFileSync(process.execPath, [cli, 'acme.demo', destination], { stdio: 'pipe' });
      const manifest: unknown = JSON.parse(
        await readFile(join(destination, 'component.manifest.json'), 'utf8'),
      );
      expect(manifest).toMatchObject({ type: 'acme.demo', version: '1.0.0' });
      expect(await readFile(join(destination, 'src/main.tsx'), 'utf8')).toContain('connectGuest');
      expect(await readFile(join(destination, 'src/main.tsx'), 'utf8')).not.toContain(
        '__COMPONENT_TYPE__',
      );
      expect(() =>
        execFileSync(process.execPath, [cli, 'acme.demo', destination], { stdio: 'pipe' }),
      ).toThrow();
      expect(() =>
        execFileSync(process.execPath, [cli, '../bad', join(parent, 'bad')], { stdio: 'pipe' }),
      ).toThrow();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
