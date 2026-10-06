// pnpm "prepare" hook: create .env for local dev and install git hooks (skipped in CI).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// CI and container builds inject env explicitly and need no git hooks.
if (process.env.CI) {
  process.exit(0);
}

await import('./ensure-env.mjs');
if (!existsSync(resolve(root, '.git'))) {
  console.log('[verbis] No .git directory; skipping git hooks.');
  process.exit(0);
}
execFileSync('pnpm', ['exec', 'husky'], { cwd: root, stdio: 'inherit' });
