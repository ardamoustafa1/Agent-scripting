import { Writable } from 'node:stream';

import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { pino } from 'pino';
import { expect, it, vi } from 'vitest';

import { createLoggerOptions } from '../../common/logging/logger.js';
import { Keyring } from '../identity/crypto/keyring.js';

import { SecureFieldSchema } from './domain/runtime.js';
import { RuntimeCipher } from './runtime-cipher.js';
import { RuntimePorts } from './runtime-ports.js';
import { SecureCaptureService } from './secure-capture.service.js';

import type { ApiEnv } from '../../env.js';
import type { RedisService } from '../../infra/redis/redis.service.js';

const tenantId = '00000000-0000-4000-8000-000000000001',
  sessionId = '00000000-0000-4000-8000-000000000002';
it('encrypted PII cannot be transplanted to another tenant/record or modified', () => {
  const cipher = new RuntimeCipher(new Keyring(`test:${Buffer.alloc(32, 7).toString('base64')}`));
  const aad = `runtime:state:${tenantId}:${sessionId}`,
    plain = '{"customer":"synthetic customer"}';
  const sealed = cipher.seal(plain, aad);
  expect(sealed).not.toContain('synthetic customer');
  expect(cipher.openString(sealed, aad)).toBe(plain);
  expect(() => cipher.openString(sealed, aad.replace(tenantId, sessionId))).toThrow();
  expect(() => cipher.openString(sealed, `${aad}other`)).toThrow();
  const tampered: Record<string, unknown> = JSON.parse(sealed) as Record<string, unknown>;
  tampered['tag'] = Buffer.alloc(16).toString('base64url');
  expect(() => cipher.openString(JSON.stringify(tampered), aad)).toThrow();
});
it('PAN/CVV cannot pass secure receipt DTO or request/log serialization', () => {
  const pan = '4111111111111111',
    cvv = '937'; // Public synthetic test vector; never real card data.
  expect(SecureFieldSchema.safeParse({ variable: 'card', receipt: pan }).success).toBe(false);
  let output = '';
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      output += chunk.toString();
      done();
    },
  });
  const logger = pino(createLoggerOptions('info'), stream);
  logger.info(
    {
      req: { method: 'POST', url: '/secure?card=' + pan, body: { pan, cvv } },
      pan,
      cvv,
      nested: { cardNumber: pan, cvc: cvv },
    },
    'capture metadata',
  );
  expect(output).not.toContain(pan);
  const line = JSON.parse(output) as {
    cvv: string;
    nested: { cvc: string };
    req: Record<string, unknown>;
  };
  expect(line.cvv).toBe('[REDACTED]');
  expect(line.nested.cvc).toBe('[REDACTED]');
  expect(line.req['body']).toBeUndefined();
});
it('verifies PSP signatures, field/session/tenant bindings and single-use receipts', async () => {
  const keys = await generateKeyPair('ES256'),
    jwk = await exportJWK(keys.publicKey);
  const set = vi.fn().mockResolvedValueOnce('OK').mockResolvedValue(null),
    ports = new RuntimePorts();
  const service = new SecureCaptureService(
    {
      PSP_TENANT_PROFILES: JSON.stringify([
        {
          tenantId,
          url: 'https://psp.example.test/capture',
          issuer: 'https://psp.example.test',
          jwks: { keys: [jwk] },
        },
      ]),
    } as ApiEnv,
    { client: { set } } as unknown as RedisService,
    ports,
  );
  service.onModuleInit();
  const receipt = await new SignJWT({
    tenantId,
    sessionId,
    variable: 'card',
    token: 'tok_' + 'a'.repeat(32),
  })
    .setProtectedHeader({ alg: 'ES256' })
    .setIssuer('https://psp.example.test')
    .setAudience('verbis-secure-field')
    .setJti('receipt-id-' + 'a'.repeat(16))
    .setIssuedAt()
    .setExpirationTime('90s')
    .sign(keys.privateKey);
  const input = { tenantId, sessionId, variable: 'card', receipt };
  await expect(ports.verify({ ...input, sessionId: tenantId })).rejects.toThrow();
  await expect(ports.verify({ ...input, variable: 'different' })).rejects.toThrow();
  await expect(ports.verify(input)).resolves.toEqual({ token: 'tok_' + 'a'.repeat(32) });
  await expect(ports.verify(input)).rejects.toThrow();
  await expect(
    ports.verify({ ...input, receipt: receipt.slice(0, -12) + 'tampered0000' }),
  ).rejects.toThrow();
  set.mockRejectedValueOnce(new Error('Redis unavailable'));
  await expect(ports.verify(input)).rejects.toThrow();
});
it('fails closed on a missing tenant provider', async () => {
  const ports = new RuntimePorts();
  await expect(
    ports.verify({ tenantId, sessionId, variable: 'card', receipt: 'tok_' + 'a'.repeat(32) }),
  ).rejects.toThrow();
});
