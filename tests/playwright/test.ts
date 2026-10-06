import path from 'node:path';

import { test as base } from '@playwright/test';

import { loadQuarantine } from '../../scripts/flaky-policy.mjs';

export * from '@playwright/test';

const manifest = await loadQuarantine();
export const test = base.extend<{ quarantinePolicy: undefined }>({
  quarantinePolicy: [
    // Playwright requires destructuring so it can discover fixture dependencies.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, info) => {
      const relative = path.relative(info.config.rootDir, info.file).replaceAll(path.sep, '/');
      const title = info.titlePath.slice(1).join(' › ');
      const entry = manifest.entries.find(
        (candidate: { project: string; file: string; title: string }) =>
          candidate.project === info.project.name &&
          candidate.file === relative &&
          candidate.title === title,
      );
      if (entry) {
        info.annotations.push({
          type: 'quarantine',
          description: `${entry.owner}: ${entry.issue}`,
        });
        if (process.env['RUN_QUARANTINED'] !== '1') info.skip(true, entry.reason);
      } else if (process.env['RUN_QUARANTINED'] === '1')
        info.skip(true, 'Dedicated quarantine lane');
      await use(undefined);
    },
    { auto: true },
  ],
});
