// Opt-in only. Authored at the user's request; never invoked during implementation.
import { spawnSync } from 'node:child_process';
import process from 'node:process';
const flags = process.argv.slice(2);
if (flags.some((flag) => !['--integration', '--e2e'].includes(flag)))
  throw new Error('Usage: pnpm test:admin [--integration] [--e2e]');
function run(args) {
  const result = spawnSync('pnpm', args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
for (const name of [
  'shared-types',
  'script-schema',
  'expr',
  'authz',
  'sdk-connector',
  'i18n',
  'ui',
])
  run(['--filter', `@verbis/${name}`, 'build']);
run(['--filter', '@verbis/admin-web', 'test']);
run([
  '--filter',
  '@verbis/api',
  'exec',
  'vitest',
  'run',
  '--project',
  'unit',
  'src/modules/admin/workspace.spec.ts',
  'src/modules/tenancy/ip-policy.spec.ts',
  'src/modules/tenancy/quota.spec.ts',
  'src/modules/runtime/runtime-state.store.spec.ts',
]);
run(['--filter', '@verbis/shared-types', 'exec', 'vitest', 'run', 'src/admin.spec.ts']);
if (flags.includes('--integration'))
  run([
    '--filter',
    '@verbis/api',
    'exec',
    'vitest',
    'run',
    '--project',
    'integration',
    'test/integration/admin-workspace.int.spec.ts',
  ]);
if (flags.includes('--e2e')) {
  run(['--filter', '@verbis/admin-web', 'build']);
  run(['--filter', '@verbis/admin-web', 'e2e', '--project', 'chromium', 'e2e/hello.spec.ts']);
}
