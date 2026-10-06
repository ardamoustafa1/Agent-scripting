// Written for an explicitly authorized future test run; not run during implementation.
import { spawnSync } from 'node:child_process';
import process from 'node:process';
const flags = process.argv.slice(2);
if (flags.some((flag) => !['--integration', '--e2e'].includes(flag)))
  throw new Error('Usage: pnpm test:lifecycle [--integration] [--e2e]');
function run(args) {
  const result = spawnSync('pnpm', args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
for (const name of [
  'shared-types',
  'collaboration',
  'script-schema',
  'expr',
  'authz',
  'i18n',
  'ui',
  'core-runtime',
  'sdk-component',
  'components',
])
  run(['--filter', `@verbis/${name}`, 'build']);
run(['--filter', '@verbis/collaboration', 'test']);
run(['--filter', '@verbis/api', 'exec', 'prisma', 'generate']);
run([
  '--filter',
  '@verbis/api',
  'exec',
  'vitest',
  'run',
  '--project',
  'unit',
  'src/modules/scripts/team-lifecycle.spec.ts',
  'src/modules/scripts/collaboration.service.spec.ts',
  'src/modules/scripts/release-jobs.service.spec.ts',
  'src/modules/scripts/draft-lease.service.spec.ts',
  'src/modules/scripts/package-dependencies.spec.ts',
  'src/modules/routing/domain/resolver.spec.ts',
]);
run(['--filter', '@verbis/shared-types', 'exec', 'vitest', 'run', 'src/lifecycle.spec.ts']);
run(['--filter', '@verbis/designer-web', 'exec', 'vitest', 'run', 'src/lifecycle/diff.spec.ts']);
if (flags.includes('--integration'))
  run([
    '--filter',
    '@verbis/api',
    'exec',
    'vitest',
    'run',
    '--project',
    'integration',
    'test/integration/authoring-routing.int.spec.ts',
  ]);
if (flags.includes('--e2e')) {
  run(['--filter', '@verbis/designer-web', 'build']);
  run(['--filter', '@verbis/designer-web', 'exec', 'playwright', 'test', 'e2e/lifecycle.spec.ts']);
}
