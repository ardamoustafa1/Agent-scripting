import { readFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
const manifest = JSON.parse(
  readFileSync(new URL('../docs/security/asvs-manifest.json', import.meta.url), 'utf8'),
);
test('ASVS inventory pins 4.0.3, has unique IDs and complete row references', () => {
  const markdown = readFileSync(
    new URL('../docs/security/ASVS_CHECKLIST.md', import.meta.url),
    'utf8',
  );
  assert.equal(manifest.version, '4.0.3');
  assert.equal(manifest.testsExecuted, false);
  assert.match(manifest.sha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.requirements.length, 286);
  assert.equal(new Set(manifest.requirements.map((row) => row.id)).size, 286);
  for (const row of manifest.requirements) {
    assert.ok(markdown.includes(`| ${row.id} |`));
    assert.ok(row.evidence.length > 0);
    assert.notEqual(row.status, 'PASS');
    for (const file of row.evidence)
      assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), file);
  }
});
