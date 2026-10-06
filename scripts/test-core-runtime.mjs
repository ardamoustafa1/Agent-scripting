#!/usr/bin/env node
// Explicitly opt-in. Never invoked by install, prepare or the application.
import { spawnSync } from 'node:child_process';
const flags = process.argv.slice(2);
if (flags.some((flag) => !['--typecheck', '--benchmark'].includes(flag)))
  throw new Error('Usage: pnpm test:core-runtime [--typecheck] [--benchmark]');
function run(args) {
  const result = spawnSync('pnpm', args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(['--filter', '@verbis/core-runtime', 'build']);
if (flags.includes('--typecheck')) run(['--filter', '@verbis/core-runtime', 'typecheck']);
run(['--filter', '@verbis/core-runtime', 'test']);
if (flags.includes('--benchmark')) run(['--filter', '@verbis/core-runtime', 'test:benchmark']);
