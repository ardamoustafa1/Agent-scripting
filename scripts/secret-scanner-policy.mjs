import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Positive canaries in the reviewed paths prove the exceptions cannot hide actual credentials.
const directory = await mkdtemp(path.join(tmpdir(), 'verbis-secret-canary-'));
try {
  const privatePath = 'apps/api/src/modules/identity/saml/sp-credentials.ts';
  const apiPath = 'apps/api/src/modules/admin/workspace.service.ts';
  const manifestPath = 'docs/verification/evidence/canary/manifest.json';
  const reportPath = 'docs/verification/V1_QUALITY_REPORT.md';
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 1024,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  for (const [file, value] of [
    [privatePath, privateKey],
    [apiPath, `const api_key = '${randomBytes(32).toString('hex')}';`],
    [manifestPath, `const api_key = '${randomBytes(32).toString('hex')}';`],
    [
      reportPath,
      `curl https://api.example.com -H 'Authorization: Bearer ${randomBytes(32).toString('hex')}'`,
    ],
  ]) {
    await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
    await writeFile(path.join(directory, file), value);
  }
  const report = path.join(directory, 'report.json');
  const result = spawnSync(
    'gitleaks',
    [
      'dir',
      directory,
      '--config',
      fileURLToPath(new URL('../.gitleaks.toml', import.meta.url)),
      '--redact',
      '--report-format',
      'json',
      '--report-path',
      report,
      '--no-banner',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 1, 'Real credentials must fail the secret gate');
  const findings = JSON.parse(await readFile(report, 'utf8'));
  for (const [file, rule] of [
    [privatePath, 'private-key'],
    [apiPath, 'generic-api-key'],
    [manifestPath, 'generic-api-key'],
    [reportPath, 'curl-auth-header'],
  ]) {
    assert.ok(
      findings.some((finding) => finding.File.endsWith(file) && finding.RuleID === rule),
      `Credential hidden in ${file}`,
    );
  }
  process.stdout.write(
    'Secret policy passed: real private keys and API keys remain detectable in exception paths.\n',
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
