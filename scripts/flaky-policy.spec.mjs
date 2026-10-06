import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateQuarantine } from './flaky-policy.mjs';
const now = new Date('2026-10-03T12:00:00Z');
const entry = {
  project: 'chromium',
  file: 'editor.spec.ts',
  title: 'drag reorder',
  owner: 'designer-team',
  reason: 'Tracked race',
  issue: 'https://example.test/issues/1',
  createdAt: '2026-10-02T12:00:00Z',
  expiresAt: '2026-10-09T12:00:00Z',
};
const check = (...entries) => validateQuarantine({ version: 1, entries }, now);
test('quarantine is explicit, bounded, reviewed and unique', () => {
  assert.deepEqual(check(entry), []);
  for (const change of [
    { expiresAt: '2026-11-01' },
    { expiresAt: '2026-10-01' },
    { owner: '' },
    { issue: '' },
    { title: 'secure launch replay' },
  ])
    assert.ok(check({ ...entry, ...change }).length);
  assert.ok(check(entry, entry).length);
});
test('empty quarantine is valid and malformed manifests fail', () => {
  assert.deepEqual(check(), []);
  assert.ok(validateQuarantine({ entries: [] }, now).length);
});
