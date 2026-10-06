#!/usr/bin/env node
// Runs every Genesys Engage connector test: hub adapter (+ Testcontainers NATS), shared schema,
// API link/token/attached-data, agent-web, admin-web and the Java sidecar (Gradle + Testcontainers).
// Usage: `pnpm test:engage` · `--typecheck` type-checks first · `--no-java` skips the sidecar.
import { spawnSync } from 'node:child_process';

const typecheck = process.argv.includes('--typecheck');
const java = !process.argv.includes('--no-java');
const suites = [
  ['@verbis/sdk-connector', ['src/platforms/genesys-engage.spec.ts']],
  ['@verbis/connector-hub', ['src/connectors/genesys-engage']],
  ['@verbis/api', ['src/modules/connectors/genesys-engage']],
  ['@verbis/agent-web', ['src/launch/engage-links.spec.ts']],
  ['@verbis/admin-web', ['src/engage']],
];

let failed = 0;
const run = (cmd, args, cwd) => {
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...(cwd === undefined ? {} : { cwd }) });
  if (result.status !== 0) failed += 1;
};
for (const [pkg, paths] of suites) {
  if (typecheck) run('pnpm', ['--filter', pkg, 'typecheck']);
  run('pnpm', ['--filter', pkg, 'exec', 'vitest', 'run', ...paths]);
}
if (java) run('gradle', ['--no-daemon', 'test'], 'apps/connector-genesys-engage-sidecar');
process.exit(failed === 0 ? 0 : 1);
