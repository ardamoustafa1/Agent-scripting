import { type ApiEnv, loadApiEnv } from '../../src/env.js';

/** Valid API env pointing at unreachable services unless overridden. */
export function testEnv(jwks: string, overrides: Record<string, string> = {}): ApiEnv {
  return loadApiEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    APP_VERSION: '1.2.3',
    DATABASE_APP_URL: 'postgresql://verbis_app:x@127.0.0.1:1/none',
    REDIS_URL: 'redis://127.0.0.1:1/0',
    NATS_URL: 'nats://127.0.0.1:1',
    INTERNAL_JWT_JWKS: jwks,
    IDENTITY_ENCRYPTION_KEYS: `test:${Buffer.alloc(32, 7).toString('base64')}`,
    OUTBOX_RELAY_ENABLED: 'false',
    EVENT_CONSUMERS_ENABLED: 'false',
    ...overrides,
  });
}
