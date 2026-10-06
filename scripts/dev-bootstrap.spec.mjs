import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseEnv } from 'node:util';
import test from 'node:test';
import { configureDevEnvironment } from './dev-environment.mjs';

const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
function fixture(t, overrides = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'verbis-bootstrap-unit-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, '.env.example'), example);
  writeFileSync(
    path.join(root, '.env'),
    example +
      '\n' +
      Object.entries(overrides)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n') +
      '\n',
  );
  return root;
}
const envAt = (root) => parseEnv(readFileSync(path.join(root, '.env'), 'utf8'));

test('fresh bootstrap provisions independently keyed features and trusted mTLS', (t) => {
  const root = fixture(t);
  configureDevEnvironment(root);
  const env = envAt(root);
  assert.equal(env.ANALYTICS_ENABLED, 'true');
  assert.equal(env.SIMULATOR_ENABLED, 'true');
  assert.equal(Buffer.from(env.INTEGRATION_MASTER_KEY, 'base64').length, 32);
  assert.equal(Buffer.from(env.ANALYTICS_PSEUDONYM_KEY, 'base64').length, 32);
  assert.notEqual(env.INTEGRATION_MASTER_KEY, env.ANALYTICS_PSEUDONYM_KEY);
  assert.deepEqual(JSON.parse(env.HUB_TRUSTED_JWKS), JSON.parse(env.INTERNAL_JWT_JWKS));
  assert.deepEqual(JSON.parse(env.INTEGRATION_RUNTIME_JWKS), JSON.parse(env.INTERNAL_JWT_JWKS));
  const ca = new X509Certificate(readFileSync(env.HUB_CA_FILE));
  const hub = new X509Certificate(readFileSync(env.HUB_CLIENT_CERT_FILE));
  const server = new X509Certificate(readFileSync(env.DEV_MTLS_CERT_FILE));
  assert.equal(ca.ca, true);
  assert.equal(hub.verify(ca.publicKey), true);
  assert.equal(server.verify(ca.publicKey), true);
  assert.ok(server.checkIP('127.0.0.1'));
  assert.ok(server.checkHost('localhost'));
  assert.ok(hub.keyUsage.includes('1.3.6.1.5.5.7.3.2'));
  assert.ok(server.keyUsage.includes('1.3.6.1.5.5.7.3.1'));
  for (const file of ['.env', '.dev/tls/hub.key', '.dev/tls/ca.key', '.dev/tls/server.key'])
    assert.equal(statSync(path.join(root, file)).mode & 0o777, 0o600);
  assert.equal(statSync(path.join(root, '.dev/tls')).mode & 0o777, 0o700);
});
test('repeat bootstrap preserves secrets and certificates and refreshes managed port URLs', (t) => {
  const root = fixture(t, {
    POSTGRES_PORT: '25432',
    KEYCLOAK_PORT: '28080',
    API_PORT: '24000',
    DEV_MTLS_PORT: '24443',
    AGENT_WEB_PORT: '25174',
    ALERTMANAGER_PORT: '29093',
  });
  configureDevEnvironment(root);
  const first = envAt(root),
    cert = readFileSync(first.HUB_CLIENT_CERT_FILE);
  assert.equal(new URL(first.DATABASE_URL).port, '25432');
  assert.equal(new URL(first.OIDC_ISSUER_URL).port, '28080');
  assert.equal(first.HUB_API_URL, 'https://localhost:24443');
  assert.match(first.AUTH_APP_ORIGINS, /agent=http:\/\/localhost:25174/);
  writeFileSync(
    path.join(root, '.env'),
    readFileSync(path.join(root, '.env'), 'utf8').replace(
      /^POSTGRES_PORT=.*$/gm,
      'POSTGRES_PORT=35432',
    ),
  );
  configureDevEnvironment(root);
  const second = envAt(root);
  assert.equal(new URL(second.DATABASE_URL).port, '35432');
  for (const key of [
    'INTERNAL_JWT_DEV_PRIVATE_JWK',
    'INTEGRATION_MASTER_KEY',
    'ANALYTICS_PSEUDONYM_KEY',
    'PACKAGE_SIGNING_JWK',
    'AUDIT_CHECKPOINT_SIGNING_JWK',
  ])
    assert.equal(second[key], first[key]);
  assert.deepEqual(readFileSync(second.HUB_CLIENT_CERT_FILE), cert);
});
test('custom endpoints and keys survive bootstrap', (t) => {
  const root = fixture(t, {
    SMTP_URL: 'smtp://localhost:39999',
    INTEGRATION_MASTER_KEY: Buffer.alloc(32, 19).toString('base64'),
  });
  configureDevEnvironment(root);
  assert.equal(envAt(root).SMTP_URL, 'smtp://localhost:39999');
  assert.equal(envAt(root).INTEGRATION_MASTER_KEY, Buffer.alloc(32, 19).toString('base64'));
});
test('production mode is rejected before files or credentials are changed', (t) => {
  const root = fixture(t, { NODE_ENV: 'production' });
  const before = readFileSync(path.join(root, '.env'));
  assert.throws(() => configureDevEnvironment(root), /development only/i);
  assert.deepEqual(readFileSync(path.join(root, '.env')), before);
});

test('unsafe network bind and remote databases are rejected without mutation', (t) => {
  for (const overrides of [
    { API_HOST: '0.0.0.0' },
    { DATABASE_URL: 'postgresql://user:synthetic@db.example.test/verbis' },
  ]) {
    const root = fixture(t, overrides),
      before = readFileSync(path.join(root, '.env'));
    assert.throws(() => configureDevEnvironment(root), /loopback/);
    assert.deepEqual(readFileSync(path.join(root, '.env')), before);
  }
});
