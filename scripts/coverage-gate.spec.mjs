import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkSummary,
  dimensions,
  criticalApiScopes,
  checkCriticalApiCoverage,
} from './coverage-gate.mjs';
const report = (pct) => ({
  total: Object.fromEntries(dimensions.map((key) => [key, { total: 100, pct }])),
});
test('accepts the boundary and rejects each deficient dimension', () => {
  assert.deepEqual(checkSummary(report(90), 90, 'pkg'), []);
  for (const metric of dimensions) {
    const summary = report(100);
    summary.total[metric].pct = 89.99;
    assert.equal(checkSummary(summary, 90, 'pkg').length, 1);
  }
});
test('missing, empty, nonnumeric and malformed reports cannot pass', () => {
  for (const value of [undefined, {}, { total: {} }, report('100')])
    assert.ok(checkSummary(value, 90, 'pkg').length);
  const empty = report(100);
  empty.total.lines.total = 0;
  assert.ok(checkSummary(empty, 90, 'pkg').length);
});

test('security scopes require weighted 95 percent line coverage and cannot disappear', () => {
  const summary = Object.fromEntries(
    criticalApiScopes.map((scope) => [
      `/repo/apps/api/src/${scope}file.ts`,
      { lines: { total: 100, covered: 95 } },
    ]),
  );
  assert.deepEqual(checkCriticalApiCoverage(summary), []);
  const missing = { ...summary };
  delete missing[Object.keys(missing)[0]];
  assert.equal(checkCriticalApiCoverage(missing).length, 1);
  summary['/repo/apps/api/src/modules/launch/large.ts'] = { lines: { total: 1000, covered: 900 } };
  assert.equal(checkCriticalApiCoverage(summary).length, 1);
});
