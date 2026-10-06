#!/usr/bin/env node
// Runs every Avaya connector test: hub adapters (AES, AACC, AXP, UUI, recording hook, shared NATS
// link via Testcontainers), admin-web routing and the Java sidecar (Gradle + Testcontainers).
// Usage: `pnpm test:avaya` · `--typecheck` type-checks first · `--no-java` skips the sidecar.
import { spawnSync } from 'node:child_process';

const typecheck = process.argv.includes('--typecheck');
const java = !process.argv.includes('--no-java');
const suites = [
  ['@verbis/connector-hub', ['src/connectors/avaya', 'src/connectors/shared']],
  ['@verbis/admin-web', ['src/avaya']],
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
if (java) run('gradle', ['--no-daemon', 'test'], 'apps/connector-avaya-aes-sidecar');
process.exit(failed === 0 ? 0 : 1);
