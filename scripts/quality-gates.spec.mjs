import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('PR acceptance runs isolated infrastructure and mandatory live projects', async () => {
  const ci = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(ci, /uses: \.\/\.github\/workflows\/verification\.yml/);
  assert.match(ci, /uses: \.\/\.github\/workflows\/live-acceptance\.yml/);
  const live = await readFile(
    new URL('../.github/workflows/live-acceptance.yml', import.meta.url),
    'utf8',
  );
  assert.match(live, /workflow_call:/);
  assert.match(live, /schedule:/);
  assert.match(live, /AGENT_E2E_SESSION_ID:/);
  const release = await readFile(
    new URL('../.github/workflows/release-images.yml', import.meta.url),
    'utf8',
  );
  assert.match(release, /needs: \[verification, live\]/);
});
test('missing live configuration fails before browser execution', () => {
  const result = spawnSync(process.execPath, ['scripts/live-acceptance.mjs'], {
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cannot silently skip/);
  assert.match(result.stderr, /AGENT_E2E_SESSION_ID/);
});

test('mandatory report gate rejects zero tests, skips, failures and malformed reports', async () => {
  const { assertTestResults } = await import('./assert-test-results.mjs');
  const good = { stats: { expected: 2, skipped: 0, unexpected: 0 }, errors: [] };
  assert.doesNotThrow(() => assertTestResults(good, 'playwright'));
  for (const stats of [
    { expected: 0, skipped: 0, unexpected: 0 },
    { expected: 2, skipped: 1, unexpected: 0 },
    { expected: 2, skipped: 0, unexpected: 1 },
    { expected: 2, skipped: '0', unexpected: 0 },
  ])
    assert.throws(() => assertTestResults({ ...good, stats }, 'playwright'));
  assert.throws(() => assertTestResults({ ...good, errors: [{}] }, 'playwright'));
  const vitest = {
    numPassedTests: 9,
    numPendingTests: 0,
    numFailedTests: 0,
    testResults: [{ status: 'passed' }],
  };
  assert.doesNotThrow(() => assertTestResults(vitest, 'vitest'));
  assert.throws(() => assertTestResults({ ...vitest, numPendingTests: 1 }, 'vitest'));
  assert.throws(() =>
    assertTestResults({ ...vitest, testResults: [{ status: 'failed' }] }, 'vitest'),
  );
  assert.throws(() => assertTestResults({}, 'vitest'));
});
