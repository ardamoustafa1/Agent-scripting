import { spawnSync } from 'node:child_process';
import process from 'node:process';
const flags = process.argv.slice(2);
if (flags.some((flag) => !['--e2e', '--typecheck'].includes(flag)))
  throw new Error('Usage: pnpm test:designer [--typecheck] [--e2e]');
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
if (flags.includes('--typecheck')) run(['--filter', '@verbis/designer-web', 'typecheck']);
run(['--filter', '@verbis/designer-web', 'test']);
if (flags.includes('--e2e')) {
  run(['--filter', '@verbis/designer-web', 'build']);
  run(['--filter', '@verbis/designer-web', 'e2e']);
}
