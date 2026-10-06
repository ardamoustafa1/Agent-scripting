import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { copyFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('commit scanner permits reviewed PEM serialization and rejects real keys and env files', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'verbis-index-scan-'));
  try {
    await copyFile(
      new URL('../.gitleaks.toml', import.meta.url),
      path.join(directory, '.gitleaks.toml'),
    );
    execFileSync('git', ['init', '-q'], { cwd: directory });
    const file = 'apps/api/src/modules/identity/saml/sp-credentials.ts';
    await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
    await copyFile(new URL(`../${file}`, import.meta.url), path.join(directory, file));
    const scan = () =>
      spawnSync(process.execPath, [fileURLToPath(new URL('./secret-scan.mjs', import.meta.url))], {
        cwd: directory,
        encoding: 'utf8',
      });
    execFileSync('git', ['add', '.'], { cwd: directory });
    const clean = scan();
    assert.equal(clean.status, 0, clean.stderr);
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 1024,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    await writeFile(path.join(directory, file), privateKey);
    execFileSync('git', ['add', '.'], { cwd: directory });
    assert.notEqual(scan().status, 0, 'Real private key must block the commit');
    await copyFile(new URL(`../${file}`, import.meta.url), path.join(directory, file));
    await writeFile(path.join(directory, '.env'), 'SYNTHETIC=true\n');
    execFileSync('git', ['add', '.'], { cwd: directory });
    const result = scan();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /file type must never be committed/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
