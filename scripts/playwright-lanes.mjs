import { spawnSync } from 'node:child_process';
import { loadQuarantine } from './flaky-policy.mjs';
await loadQuarantine();
const mode = process.argv[2];
if (!['flaky', 'quarantine', 'visual'].includes(mode))
  throw new Error('Expected flaky, quarantine or visual');
// LANE_APP / LANE_SHARD ("2/4") split the 5x repeat lane across CI jobs; unset runs everything.
const only = process.env['LANE_APP'];
const shard = process.env['LANE_SHARD'];
for (const app of ['designer-web', 'agent-web', 'admin-web'].filter((a) => !only || a === only)) {
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
  if (shard) args.push(`--shard=${shard}`);
  if (mode === 'visual') args.push('--grep', '@visual', ...process.argv.slice(3));
  const result = spawnSync('pnpm', args, {
    stdio: 'inherit',
    env: { ...process.env, ...(mode === 'quarantine' ? { RUN_QUARANTINED: '1' } : {}) },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = 1;
}
