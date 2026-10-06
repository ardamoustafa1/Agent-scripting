/** Explicit future execution only. Dependencies/IdP/mTLS are operator-provisioned isolated fixtures. */
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
if (process.env.DEMO_SMOKE !== '1')
  throw new Error('Set DEMO_SMOKE=1 for the isolated clean-installation acceptance lane');
const file = process.env.DEMO_SMOKE_ENV_FILE;
if (!file || !path.isAbsolute(file) || file.startsWith(root))
  throw new Error('DEMO_SMOKE_ENV_FILE must be an absolute file outside the repository');
process.loadEnvFile(file);
const env = {
  ...process.env,
  NODE_ENV: 'development',
  DEMO_SMOKE: '1',
  DEMO_REQUIRE_EMPTY_DB: '1',
  SIMULATOR_ENABLED: 'true',
};
for (const name of [
  'DATABASE_URL',
  'DATABASE_APP_URL',
  'DEMO_OIDC_ISSUER',
  'DEMO_OIDC_CLIENT_ID',
  'DEMO_OIDC_CLIENT_SECRET',
  'DEMO_SMOKE_PASSWORD',
  'DEMO_HUB_CERT_THUMBPRINT',
  'HUB_TENANTS',
  'HUB_CLIENT_CERT_FILE',
  'HUB_CLIENT_KEY_FILE',
])
  if (!env[name]) throw new Error(name + ' is required');
const database = new URL(env.DATABASE_URL);
const appDatabase = new URL(env.DATABASE_APP_URL);
for (const connection of [database, appDatabase])
  if (
    !['postgres:', 'postgresql:'].includes(connection.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname) ||
    !['/verbis_demo', '/verbis_test'].includes(connection.pathname)
  )
    throw new Error('Use a dedicated local verbis_demo or verbis_test database');
if (
  database.hostname !== appDatabase.hostname ||
  (database.port || '5432') !== (appDatabase.port || '5432') ||
  database.pathname !== appDatabase.pathname
)
  throw new Error('Migration and application connections must target the same isolated database');
const run = (args) => {
  const result = spawnSync('pnpm', args, { cwd: root, env, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Clean demo stage failed; review redacted local logs');
};
// Existing service processes must never be mistaken for this clean installation.
for (const port of [4000, 4100, 5173, 5174, 5175]) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', () => reject(new Error('Clean demo requires unused application ports')));
    server.listen(port, 'localhost', () => server.close(resolve));
  });
}
run(['install', '--frozen-lockfile']);
run(['build']);
run(['db:migrate']);
run(['seed:demo']); // The transactional empty-database guard refuses reuse of a populated installation.
const processes = [
  ['--filter', '@verbis/api', 'dev'],
  ['--filter', '@verbis/connector-hub', 'dev'],
  ['--filter', '@verbis/admin-web', 'dev'],
  ['--filter', '@verbis/designer-web', 'dev'],
  ['--filter', '@verbis/agent-web', 'dev'],
].map((args) => spawn('pnpm', args, { cwd: root, env, stdio: 'inherit', detached: true }));
try {
  const urls = [
    'http://localhost:5173/health',
    'http://localhost:5174/health',
    'http://localhost:5175/health',
    'http://localhost:4000/health/ready',
    'http://localhost:4100/health/ready',
  ];
  const deadline = Date.now() + 90_000;
  for (const url of urls) {
    while (true) {
      if (processes.some((child) => child.exitCode !== null))
        throw new Error('A demo service exited before readiness');
      const ready = await fetch(url, { signal: AbortSignal.timeout(2000) })
        .then((response) => response.ok)
        .catch(() => false);
      if (ready) break;
      if (Date.now() >= deadline) throw new Error('Demo readiness timed out');
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  run(['exec', 'playwright', 'test', '--config', 'tests/demo-smoke/playwright.config.ts']);
} finally {
  for (const child of processes)
    if (child.pid) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        /* Already exited. */
      }
    }
}
