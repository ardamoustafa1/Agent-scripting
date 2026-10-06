#!/usr/bin/env node
// Runs every Genesys Cloud connector test (hub adapter, region table, API PKCE link, agent-web
// popup, admin-web routing). Usage: `pnpm test:genesys` (add `--typecheck` to type-check first).
import { spawnSync } from 'node:child_process';

const typecheck = process.argv.includes('--typecheck');
const suites = [
  ['@verbis/sdk-connector', ['src/platforms']],
  ['@verbis/connector-hub', ['src/connectors/genesys-cloud']],
  ['@verbis/api', ['src/modules/connectors/genesys-cloud']],
  ['@verbis/agent-web', ['src/launch/genesys-link.spec.ts']],
  ['@verbis/admin-web', ['src/genesys']],
];

let failed = 0;
for (const [pkg, paths] of suites) {
  if (typecheck) {
    const tc = spawnSync('pnpm', ['--filter', pkg, 'typecheck'], { stdio: 'inherit' });
    if (tc.status !== 0) failed += 1;
  }
  const run = spawnSync('pnpm', ['--filter', pkg, 'exec', 'vitest', 'run', ...paths], {
    stdio: 'inherit',
  });
  if (run.status !== 0) failed += 1;
}
process.exit(failed === 0 ? 0 : 1);
