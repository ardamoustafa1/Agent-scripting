/** Executes the README sequence in a disposable clean source copy and Compose project. */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  closeSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { assertTestResults } from './assert-test-results.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const clean = mkdtempSync(path.join(tmpdir(), 'verbis-clean-bootstrap-'));
const report = path.join(root, 'reports/bootstrap');
mkdirSync(report, { recursive: true });
const logFile = openSync(path.join(report, 'acceptance.txt'), 'w', 0o600);
const ignored = new Set([
  '.git',
  'node_modules',
  '.dev',
  '.turbo',
  'dist',
  'build',
  'coverage',
  'playwright-report',
  'test-results',
  'blob-report',
  'reports',
  'artifacts',
  '.astro',
  '.vite',
  '.stryker-tmp',
  'npm-audit.json',
]);
const copied = path.join(clean, 'repo');
cpSync(root, copied, {
  recursive: true,
  filter: (source) => {
    const relative = path.relative(root, source);
    return (
      !relative.endsWith('.tsbuildinfo') &&
      !relative.startsWith(`apps${path.sep}api${path.sep}src${path.sep}generated`) &&
      !relative.split(path.sep).some((part) => ignored.has(part)) &&
      !relative.startsWith(`docs${path.sep}verification${path.sep}evidence`) &&
      !/^\.env(?:$|\.)/.test(relative.replace(/^\.env\.example$/, ''))
    );
  },
});
const env = { ...process.env, CI: '' };
for (const key of Object.keys(parseEnv(readFileSync(path.join(copied, '.env.example'), 'utf8'))))
  delete env[key];
env.COMPOSE_PROJECT_NAME = `verbis-bootstrap-${path.basename(clean).toLowerCase()}`;
const run = (args, extra = {}) => {
  console.log(`[bootstrap acceptance] pnpm ${args.join(' ')}`);
  const result = spawnSync('pnpm', args, {
    cwd: copied,
    env: { ...env, ...extra },
    stdio: ['ignore', logFile, logFile],
    timeout: 600000,
  });
  if (result.error || result.status !== 0)
    throw new Error(`Clean bootstrap stage failed: pnpm ${args.join(' ')}`);
};
const freePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(String(port)));
    });
  });
const wait = async (probe, label) => {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (await probe()) return;
    if (child?.exitCode !== null && child?.exitCode !== undefined)
      throw new Error('pnpm dev exited during acceptance');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Bootstrap readiness timed out: ${label}`);
};
let child, settings;
try {
  run(['install', '--frozen-lockfile']);
  const ports = Object.keys(
    parseEnv(readFileSync(path.join(copied, '.env.example'), 'utf8')),
  ).filter((key) => key.endsWith('_PORT'));
  const updates = {};
  const assigned = new Set();
  for (const key of ports) {
    let value;
    do {
      value = await freePort();
    } while (assigned.has(value));
    assigned.add(value);
    updates[key] = value;
  }
  const { writeEnvironment, readEnvironment } = await import(
    pathToFileURL(path.join(copied, 'scripts/dev-environment.mjs')).href
  );
  writeEnvironment(copied, updates);
  run(['dev:bootstrap'], { DEV_BOOTSTRAP_REQUIRE_EMPTY: '1' });
  settings = readEnvironment(copied);
  const state = JSON.parse(readFileSync(path.join(copied, '.dev/bootstrap.json'), 'utf8'));
  const keys = [
    'INTEGRATION_MASTER_KEY',
    'ANALYTICS_PSEUDONYM_KEY',
    'PACKAGE_SIGNING_JWK',
    'INTERNAL_JWT_DEV_PRIVATE_JWK',
    'AUDIT_CHECKPOINT_SIGNING_JWK',
  ];
  const fingerprints = keys.map((key) => createHash('sha256').update(settings[key]).digest('hex'));
  // Independently prove pnpm seed restores generated Prisma and workspace prerequisites.
  rmSync(path.join(copied, 'apps/api/src/generated'), { recursive: true, force: true });
  rmSync(path.join(copied, 'packages/authz/dist'), { recursive: true, force: true });
  run(['seed']);
  run(['dev:bootstrap']);
  settings = readEnvironment(copied);
  assert.deepEqual(
    keys.map((key) => createHash('sha256').update(settings[key]).digest('hex')),
    fingerprints,
    'Bootstrap rotated existing keys',
  );
  assert.deepEqual(
    JSON.parse(readFileSync(path.join(copied, '.dev/bootstrap.json'), 'utf8')).hub,
    state.hub,
  );
  child = spawn('pnpm', ['dev'], {
    cwd: copied,
    env,
    stdio: ['ignore', logFile, logFile],
    detached: true,
  });
  const urls = [
    `http://127.0.0.1:${settings.API_PORT}/health/ready`,
    `http://127.0.0.1:${settings.CONNECTOR_HUB_PORT}/health`,
    `http://127.0.0.1:${settings.AUDIT_WORKER_HEALTH_PORT}/health/ready`,
    ...['DESIGNER', 'AGENT', 'ADMIN'].map(
      (app) => `http://127.0.0.1:${settings[app + '_WEB_PORT']}/health`,
    ),
  ];
  for (const url of urls)
    await wait(
      () =>
        fetch(url, { signal: AbortSignal.timeout(2000) })
          .then((r) => r.ok)
          .catch(() => false),
      url,
    );
  const require = createRequire(path.join(copied, 'apps/api/package.json'));
  const { importJWK, SignJWT } = await import(pathToFileURL(require.resolve('jose')).href);
  const jwk = JSON.parse(settings.INTERNAL_JWT_DEV_PRIVATE_JWK),
    key = await importJWK(jwk, 'EdDSA');
  const token = await new SignJWT({ tnt: state.tenantId, typ: 'user' })
    .setProtectedHeader({ alg: 'EdDSA', kid: jwk.kid })
    .setSubject('01928f3a-0000-7000-8000-00000000d101')
    .setIssuer(settings.INTERNAL_JWT_ISSUER)
    .setAudience(settings.INTERNAL_JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('5m')
    .setJti(crypto.randomUUID())
    .sign(key);
  const api = async (route, body) => {
    const response = await fetch(`http://127.0.0.1:${settings.API_PORT}${route}`, {
      method: body ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    return response.json();
  };
  await wait(
    async () =>
      (await api(`/v1/simulator/connectors/${state.simulatorId}`))?.connectorId ===
      state.simulatorId,
    'mTLS-backed simulator',
  );
  let verification;
  await wait(async () => {
    verification = await api('/v1/audit-events/verify', {});
    return verification?.valid === true && verification.checkpointsChecked > 0;
  }, 'worker signed checkpoint');
  // Existing real SSO spec also verifies scoped port-derived realm redirect URIs and axe.
  run(['--filter', '@verbis/admin-web', 'exec', 'playwright', 'test', '--project=keycloak'], {
    ...settings,
    E2E_KEYCLOAK: '1',
    E2E_LIVE: '1',
    CI: '',
  });
  const sso = JSON.parse(
    readFileSync(path.join(copied, 'apps/admin-web/test-results/results.json'), 'utf8'),
  );
  assertTestResults(sso, 'playwright');
  writeFileSync(
    path.join(report, 'summary.json'),
    JSON.stringify(
      {
        date: new Date().toISOString(),
        cleanInstall: true,
        seedRestoresMissingPrerequisites: true,
        bootstrapRepeatPreservesKeys: true,
        healthEndpoints: urls.length,
        simulatorConnectedOverMtls: true,
        auditChainValid: verification.valid,
        checkpointsChecked: verification.checkpointsChecked,
        sso: { passed: sso.stats.expected, skipped: sso.stats.skipped },
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    '[bootstrap acceptance] clean install, repeated bootstrap, six health endpoints, simulator mTLS, signed audit checkpoint and Keycloak/axe passed',
  );
} catch (error) {
  console.error(error.message);
  console.error(`Review ${path.join(report, 'acceptance.txt')}`);
  process.exitCode = 1;
} finally {
  if (child?.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* exited */
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* exited */
    }
  }
  spawnSync('docker', ['compose', 'down', '-v', '--remove-orphans'], {
    cwd: copied,
    env: { ...env, ...settings },
    stdio: ['ignore', logFile, logFile],
    timeout: 60000,
  });
  closeSync(logFile);
  rmSync(clean, { recursive: true, force: true });
}
