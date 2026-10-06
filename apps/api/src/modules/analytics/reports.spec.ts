import { expect, it } from 'vitest';

import { csvCell, csvReport, xlsxReport } from './export.js';
import { fixtureFact } from './fixtures.js';
import { aggregate } from './metrics.js';
import { nextRun } from './reports.js';

it('schedules daily or Monday UTC strictly in the future', () => {
  expect(
    nextRun({ frequency: 'daily', hourUtc: 8 }, new Date('2026-10-03T08:00:00Z')).toISOString(),
  ).toBe('2026-10-04T08:00:00.000Z');
  expect(
    nextRun({ frequency: 'weekly', hourUtc: 8 }, new Date('2026-10-03T08:00:00Z')).toISOString(),
  ).toBe('2026-10-05T08:00:00.000Z');
});
it('guards CSV formulas, quotes and line breaks', () => {
  expect(csvCell(' =HYPERLINK("bad")')).toBe('"\' =HYPERLINK(""bad"")"');
  expect(csvCell('a\nb')).toBe('"a\nb"');
});
it('produces real XLSX ZIP bytes and safe metadata CSV', async () => {
  const d = aggregate([fixtureFact(0)]);
  expect(csvReport(d)).toContain('completionRate');
  const bytes = await xlsxReport(d);
  expect(bytes.subarray(0, 2).toString()).toBe('PK');
  expect(bytes.length).toBeGreaterThan(1000);
});
