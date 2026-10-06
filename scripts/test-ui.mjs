#!/usr/bin/env node
// Opt-in checks; this script never runs from install/prepare.
import { spawnSync } from 'node:child_process';
const flags = process.argv.slice(2);
if (
  flags.some((flag) => !['--typecheck', '--visual', '--update-snapshots'].includes(flag)) ||
  (flags.includes('--update-snapshots') && !flags.includes('--visual'))
)
  throw new Error('Usage: pnpm test:ui [--typecheck] [--visual [--update-snapshots]]');
function run(args) {
  const result = spawnSync('pnpm', args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(['--filter', '@verbis/i18n', 'build']);
if (flags.includes('--typecheck')) run(['--filter', '@verbis/ui', 'typecheck']);
run(['--filter', '@verbis/ui', 'test']);
if (flags.includes('--visual'))
  run([
    '--filter',
    '@verbis/ui',
    'exec',
    'playwright',
    'test',
    ...(flags.includes('--update-snapshots') ? ['--update-snapshots'] : []),
  ]);
