// Opt-in production benchmark. No application/install hook imports this file.
import { spawnSync } from 'node:child_process';
import process from 'node:process';

for (const args of [
  ['benchmark:build'],
  ['exec', 'playwright', 'test', ...process.argv.slice(2)],
]) {
  const result = spawnSync('pnpm', args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
