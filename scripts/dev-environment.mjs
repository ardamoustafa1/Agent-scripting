import { execFileSync } from 'node:child_process';
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  X509Certificate,
} from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { ensureEnv } from './ensure-env.mjs';

export const readEnvironment = (root) => parseEnv(readFileSync(path.join(root, '.env'), 'utf8'));
const digest = (value) => createHash('sha256').update(value).digest('hex');
export function writeEnvironment(root, updates) {
  const file = path.join(root, '.env');
  let text = readFileSync(file, 'utf8');
  for (const [key, value] of Object.entries(updates)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || /[\r\n]/.test(value))
      throw new Error('Invalid dev environment setting');
    const pattern = new RegExp(`^${key}=.*$`, 'gm');
    const line = `${key}=${value}`;
    text = pattern.test(text) ? text.replace(pattern, () => line) : `${text.trimEnd()}\n${line}\n`;
  }
  writeFileSync(file, text, { mode: 0o600 });
  chmodSync(file, 0o600);
}
export function assertDevelopment(root) {
  const file = path.join(root, '.env');
  const env = existsSync(file) ? readEnvironment(root) : {};
  if (
    (env.NODE_ENV && env.NODE_ENV !== 'development') ||
    (process.env.NODE_ENV && process.env.NODE_ENV !== 'development')
  )
    throw new Error('dev:bootstrap is development only');
  for (const key of ['API_HOST', 'CONNECTOR_HUB_HOST'])
    if (env[key] && !['localhost', '127.0.0.1', '::1'].includes(env[key]))
      throw new Error(`Dev mTLS requires a loopback ${key}`);
  for (const key of [
    'DATABASE_URL',
    'DATABASE_APP_URL',
    'AUDIT_WORKER_DATABASE_URL',
    'API_INTERNAL_URL',
    'HUB_API_URL',
  ])
    if (env[key] && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(env[key]).hostname))
      throw new Error(`dev:bootstrap requires a loopback ${key}`);
}
function provisionCertificates(root) {
  const directory = path.join(root, '.dev/tls');
  const names = ['ca.pem', 'ca.key', 'hub.pem', 'hub.key', 'server.pem', 'server.key'];
  if (existsSync(directory)) {
    if (names.some((name) => !existsSync(path.join(directory, name))))
      throw new Error('Incomplete dev TLS directory; restore its files before bootstrap');
    const ca = new X509Certificate(readFileSync(path.join(directory, 'ca.pem')));
    for (const name of ['hub.pem', 'server.pem']) {
      const cert = new X509Certificate(readFileSync(path.join(directory, name)));
      if (!cert.verify(ca.publicKey) || Date.parse(cert.validTo) <= Date.now())
        throw new Error(
          'Dev TLS certificate expired or does not match its CA; renew the local TLS directory',
        );
    }
  } else {
    const temporary = mkdtempSync(path.join(root, '.dev/tls-'));
    const run = (...args) => execFileSync('openssl', args, { cwd: temporary, stdio: 'ignore' });
    try {
      run(
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        'ca.key',
        '-out',
        'ca.pem',
        '-days',
        '3650',
        '-subj',
        '/CN=Verbis local development CA',
        '-addext',
        'basicConstraints=critical,CA:TRUE',
      );
      for (const name of ['server', 'hub']) {
        run(
          'req',
          '-newkey',
          'rsa:2048',
          '-nodes',
          '-keyout',
          `${name}.key`,
          '-out',
          `${name}.csr`,
          '-subj',
          `/CN=Verbis development ${name}`,
        );
        writeFileSync(
          path.join(temporary, `${name}.ext`),
          name === 'server'
            ? 'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n'
            : 'extendedKeyUsage=clientAuth\n',
          { mode: 0o600 },
        );
        run(
          'x509',
          '-req',
          '-in',
          `${name}.csr`,
          '-CA',
          'ca.pem',
          '-CAkey',
          'ca.key',
          '-CAcreateserial',
          '-out',
          `${name}.pem`,
          '-days',
          '365',
          '-extfile',
          `${name}.ext`,
        );
      }
      renameSync(temporary, directory);
    } catch {
      rmSync(temporary, { recursive: true, force: true });
      throw new Error('OpenSSL dev certificate provisioning failed');
    }
  }
  chmodSync(directory, 0o700);
  for (const name of names) chmodSync(path.join(directory, name), 0o600);
  return directory;
}

export function configureDevEnvironment(root) {
  assertDevelopment(root);
  ensureEnv(root);
  mkdirSync(path.join(root, '.dev'), { recursive: true, mode: 0o700 });
  const stateFile = path.join(root, '.dev/bootstrap.json');
  const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};
  const env = readEnvironment(root),
    defaults = parseEnv(readFileSync(path.join(root, '.env.example'), 'utf8'));
  const managed = { ...state.managed },
    updates = {};
  const setDefault = (key, value) => {
    if (!env[key] || env[key] === defaults[key] || managed[key] === digest(env[key])) {
      updates[key] = value;
      managed[key] = digest(value);
      env[key] = value;
    }
  };
  const local = (port) => `http://localhost:${port}`;
  const internal = (port) => `http://127.0.0.1:${port}`;
  const db = (user, password) =>
    `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${env.POSTGRES_PORT}/${encodeURIComponent(env.POSTGRES_DB)}?schema=public`;
  setDefault('DATABASE_URL', db(env.POSTGRES_USER, env.POSTGRES_PASSWORD));
  setDefault('DATABASE_APP_URL', db('verbis_app', env.DATABASE_APP_PASSWORD));
  setDefault(
    'AUDIT_WORKER_DATABASE_URL',
    db('verbis_audit_worker', env.DATABASE_AUDIT_WORKER_PASSWORD),
  );
  setDefault(
    'REDIS_URL',
    `redis://:${encodeURIComponent(env.REDIS_PASSWORD)}@127.0.0.1:${env.REDIS_PORT}/0`,
  );
  setDefault('NATS_URL', `nats://127.0.0.1:${env.NATS_PORT}`);
  setDefault('OIDC_ISSUER_URL', `${local(env.KEYCLOAK_PORT)}/realms/verbis-dev`);
  setDefault('S3_ENDPOINT', internal(env.MINIO_API_PORT));
  setDefault('SMTP_URL', `smtp://127.0.0.1:${env.SMTP_PORT}`);
  setDefault('OTEL_EXPORTER_OTLP_ENDPOINT', internal(env.OTEL_HTTP_PORT));
  setDefault('PUBLIC_API_URL', local(env.API_PORT));
  setDefault('API_INTERNAL_URL', internal(env.API_PORT));
  setDefault('CONNECTOR_HUB_URL', internal(env.CONNECTOR_HUB_PORT));
  setDefault(
    'AUTH_APP_ORIGINS',
    `admin=${local(env.ADMIN_WEB_PORT)},designer=${local(env.DESIGNER_WEB_PORT)},agent=${local(env.AGENT_WEB_PORT)}`,
  );
  setDefault(
    'CORS_ALLOWED_ORIGINS',
    [env.DESIGNER_WEB_PORT, env.AGENT_WEB_PORT, env.ADMIN_WEB_PORT].map(local).join(','),
  );
  setDefault('BREAK_GLASS_ALLOWED_ORIGINS', local(env.ADMIN_WEB_PORT));
  setDefault('HUB_TRUSTED_JWKS', env.INTERNAL_JWT_JWKS);
  setDefault('INTEGRATION_RUNTIME_JWKS', env.INTERNAL_JWT_JWKS);
  for (const key of ['INTEGRATION_MASTER_KEY', 'ANALYTICS_PSEUDONYM_KEY', 'MTLS_PROXY_SECRET'])
    if (!env[key]) updates[key] = randomBytes(32).toString('base64');
  setDefault('ANALYTICS_ENABLED', 'true');
  setDefault('SIMULATOR_ENABLED', 'true');
  if (!env.PACKAGE_SIGNING_JWK) {
    const pair = generateKeyPairSync('ed25519');
    const kid = `package-dev-${randomUUID()}`;
    updates.PACKAGE_SIGNING_JWK = JSON.stringify({
      ...pair.privateKey.export({ format: 'jwk' }),
      kid,
      alg: 'EdDSA',
    });
    setDefault(
      'PACKAGE_TRUSTED_JWKS',
      JSON.stringify({
        keys: [{ ...pair.publicKey.export({ format: 'jwk' }), kid, alg: 'EdDSA' }],
      }),
    );
  }
  const tls = provisionCertificates(root);
  setDefault('HUB_API_URL', `https://localhost:${env.DEV_MTLS_PORT}`);
  setDefault('MTLS_CLIENT_CERT_HEADER', 'x-verbis-dev-client-cert');
  setDefault('HUB_CLIENT_CERT_FILE', path.join(tls, 'hub.pem'));
  setDefault('HUB_CLIENT_KEY_FILE', path.join(tls, 'hub.key'));
  setDefault('HUB_CA_FILE', path.join(tls, 'ca.pem'));
  setDefault('DEV_MTLS_CERT_FILE', path.join(tls, 'server.pem'));
  setDefault('DEV_MTLS_KEY_FILE', path.join(tls, 'server.key'));
  writeEnvironment(root, updates);
  writeFileSync(stateFile, JSON.stringify({ ...state, managed }, null, 2) + '\n', { mode: 0o600 });
  return readEnvironment(root);
}
