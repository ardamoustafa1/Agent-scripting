import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProfile } from '../infra/k6/profile.js';

// Read-only: never log cookies, CSRF, IDs, certificate/key content, or fixture paths.
try {
  const path = realpathSync(process.env.K6_AGENT_FIXTURE || '');
  const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  if (path === repository || path.startsWith(repository + sep))
    throw new Error('Private load fixtures must remain outside the repository');
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > 100 * 1024 * 1024 || (stat.mode & 0o077) !== 0)
    throw new Error('Fixture must be a private file (chmod 600), at most 100 MiB');
  let fixture;
  try {
    fixture = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('Fixture must contain valid JSON');
  }
  const profile = loadProfile(process.env, fixture?.agents, process.argv[2]);
  process.stdout.write(JSON.stringify({ preflight: 'passed', networkRequests: 0, profile }) + '\n');
} catch (error) {
  // OS errors may contain sensitive paths. Validation errors contain only fixed labels.
  process.stderr.write((error.code ? 'Cannot read private fixture file' : error.message) + '\n');
  process.exitCode = 1;
}
