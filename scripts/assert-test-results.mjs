import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/** Mandatory acceptance lanes must execute tests, with neither skips nor failures. */
export function assertTestResults(report, kind) {
  if (!report || typeof report !== 'object') throw new Error('Missing test report');
  const counts =
    kind === 'playwright'
      ? [
          report.stats?.expected,
          report.stats?.skipped,
          report.stats?.unexpected,
          report.errors?.length,
        ]
      : kind === 'vitest'
        ? [
            report.numPassedTests,
            report.numPendingTests,
            report.numFailedTests,
            report.testResults?.filter((suite) => suite.status !== 'passed').length,
          ]
        : [];
  if (counts.length !== 4 || counts.some((count) => !Number.isSafeInteger(count) || count < 0))
    throw new Error('Malformed test counts');
  const [passed, skipped, failed, errors] = counts;
  if (!passed || skipped || failed || errors)
    throw new Error(
      `Mandatory ${kind} acceptance: passed=${passed}, skipped=${skipped}, failed=${failed}, errors=${errors}`,
    );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assertTestResults(JSON.parse(await readFile(process.argv[2], 'utf8')), process.argv[3]);
}
