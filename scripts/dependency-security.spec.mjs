import assert from 'node:assert/strict';
import test from 'node:test';
import { unresolvedAdvisories } from './dependency-security.mjs';
const remediation = {
  package: 'extract-zip',
  version: '2.0.1',
  advisories: [1139346, 1193685],
  expires: '2026-11-03',
};
const advisory = {
  id: 1139346,
  module_name: 'extract-zip',
  severity: 'high',
  findings: [{ version: '2.0.1' }],
};
const report = (item) => ({ metadata: { vulnerabilities: {} }, advisories: { issue: item } });
test('only exact, unexpired, patched advisories are classified as locally remediated', () => {
  assert.deepEqual(unresolvedAdvisories(report(advisory), remediation, '2026-10-04'), []);
  for (const change of [
    { id: 999 },
    { module_name: 'other' },
    { severity: 'critical' },
    { findings: [{ version: '2.0.2' }] },
    { findings: [] },
  ])
    assert.equal(
      unresolvedAdvisories(report({ ...advisory, ...change }), remediation, '2026-10-04').length,
      1,
    );
  assert.equal(unresolvedAdvisories(report(advisory), remediation, '2026-11-04').length, 1);
  assert.throws(() => unresolvedAdvisories({ error: {} }, remediation));
});
