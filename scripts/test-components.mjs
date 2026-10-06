#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
const flags = process.argv.slice(2);
if (flags.some((flag) => !['--typecheck', '--a11y'].includes(flag)))
  throw new Error('Usage: pnpm test:components [--typecheck] [--a11y]');
function run(args) {
  const result = spawnSync('pnpm', args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(['--filter', '@verbis/components', 'build']);
for (const name of ['sdk-component', 'components']) {
  if (flags.includes('--typecheck')) run(['--filter', `@verbis/${name}`, 'typecheck']);
  run(['--filter', `@verbis/${name}`, 'test']);
}
if (flags.includes('--a11y')) run(['--filter', '@verbis/components', 'test:a11y']);
