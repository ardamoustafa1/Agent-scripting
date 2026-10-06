import { spawnSync } from 'node:child_process';
import { loadQuarantine } from './flaky-policy.mjs';
await loadQuarantine();
const mode = process.argv[2];
if (!['flaky', 'quarantine', 'visual'].includes(mode))
  throw new Error('Expected flaky, quarantine or visual');
for (const app of ['designer-web', 'agent-web', 'admin-web']) {
  const args = [
    '--filter',
    `@verbis/${app}`,
    'exec',
    'playwright',
    'test',
    '--project',
    'chromium',
  ];
  if (mode === 'flaky') args.push('--repeat-each=5', '--retries=0');
  if (mode === 'visual') args.push('--grep', '@visual', ...process.argv.slice(3));
  const result = spawnSync('pnpm', args, {
    stdio: 'inherit',
    env: { ...process.env, ...(mode === 'quarantine' ? { RUN_QUARANTINED: '1' } : {}) },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = 1;
}
