// Explicit future execution only. This script was authored, not run.
import { spawnSync } from 'node:child_process';
import process from 'node:process';
const flags = process.argv.slice(2);
if (flags.some((flag) => !['--e2e'].includes(flag))) throw Error('Usage: pnpm test:agent [--e2e]');
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
  'core-runtime',
  'sdk-component',
  'components',
])
  run(['--filter', `@verbis/${name}`, 'build']);
run(['--filter', '@verbis/agent-web', 'test']);
run([
  '--filter',
  '@verbis/api',
  'exec',
  'vitest',
  'run',
  '--project',
  'unit',
  'src/modules/runtime/agent-desktop.controller.spec.ts',
  'src/modules/runtime/runtime-platform-state.spec.ts',
]);
run([
  '--filter',
  '@verbis/core-runtime',
  'exec',
  'vitest',
  'run',
  'src/runtime.spec.ts',
  'src/store.spec.ts',
]);
if (flags.includes('--e2e')) {
  run(['--filter', '@verbis/agent-web', 'build']);
  run(['--filter', '@verbis/agent-web', 'e2e']);
}
