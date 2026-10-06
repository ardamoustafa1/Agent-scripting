import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { FullConfig, FullResult, Reporter, Suite } from '@playwright/test/reporter';

export default class FlakyReporter implements Reporter {
  private suite?: Suite;
  private rootDir = process.cwd();
  onBegin(config: FullConfig, suite: Suite) {
    this.suite = suite;
    this.rootDir = config.rootDir;
  }
  async onEnd(result: FullResult) {
    const groups = new Map<
      string,
      {
        file: string;
        title: string;
        project: string;
        quarantined: boolean;
        attempts: { repeat: number; retry: number; status: string; duration: number }[];
      }
    >();
    for (const test of this.suite?.allTests() ?? []) {
      const file = path.relative(this.rootDir, test.location.file).replaceAll(path.sep, '/');
      const title = test.titlePath().slice(3).join(' › ');
      const project = test.parent.project()?.name ?? '';
      const key = `${project}/${file}/${title}`;
      const row = groups.get(key) ?? { file, title, project, quarantined: false, attempts: [] };
      row.quarantined ||= test.annotations.some((annotation) => annotation.type === 'quarantine');
      row.attempts.push(
        ...test.results.map((attempt) => ({
          repeat: test.repeatEachIndex,
          retry: attempt.retry,
          status: attempt.status,
          duration: attempt.duration,
        })),
      );
      groups.set(key, row);
    }
    const flaky = [...groups.values()].filter(
      (row) =>
        row.attempts.some((a) => a.status === 'passed') &&
        row.attempts.some((a) => ['failed', 'timedOut', 'interrupted'].includes(a.status)),
    );
    await mkdir('test-results', { recursive: true });
    await writeFile(
      'test-results/flaky.json',
      JSON.stringify({ status: result.status, flaky }, null, 2),
    );
    if (
      flaky.some((row) => !row.quarantined) ||
      (process.env['RUN_QUARANTINED'] === '1' && flaky.length)
    )
      return { status: 'failed' as const };
    return undefined;
  }
}
