/**
 * Mints a short-lived internal JWT for local development (what the BFF will do in step 7).
 * Usage: pnpm --filter @verbis/api dev:token [userId|service:<name>] [tenantId]
 * Refuses to run in production. The signing key exists only in your local .env.
 */
import path from 'node:path';

import { config as loadDotenv } from 'dotenv';
import { importJWK, SignJWT, type JWK } from 'jose';

loadDotenv({ path: path.resolve(import.meta.dirname, '../../../.env'), quiet: true });

if (process.env['NODE_ENV'] === 'production') {
  process.stderr.write('dev-token is not available in production\n');
  process.exit(1);
}
const rawKey = process.env['INTERNAL_JWT_DEV_PRIVATE_JWK'];
if (rawKey === undefined || rawKey === '') {
  process.stderr.write(
    'INTERNAL_JWT_DEV_PRIVATE_JWK is not set (run pnpm install to generate it)\n',
  );
  process.exit(1);
}

const DEV_TENANT_ID = '01928f3a-0000-7000-8000-00000000d001';
const DEV_ADMIN_ID = '01928f3a-0000-7000-8000-00000000d101';
const [subject = DEV_ADMIN_ID, tenantId = DEV_TENANT_ID] = process.argv.slice(2);
const isService = subject.startsWith('service:');
const jwk = JSON.parse(rawKey) as JWK;
const key = await importJWK(jwk, 'EdDSA');
const token = await new SignJWT({
  tnt: tenantId,
  typ: isService ? 'service' : 'user',
  ...(isService ? { scp: ['manage:all'] } : {}),
})
  .setProtectedHeader({ alg: 'EdDSA', ...(jwk.kid === undefined ? {} : { kid: jwk.kid }) })
  .setSubject(isService ? subject.slice('service:'.length) : subject)
  .setIssuer(process.env['INTERNAL_JWT_ISSUER'] ?? 'verbis-api-gateway')
  .setAudience(process.env['INTERNAL_JWT_AUDIENCE'] ?? 'verbis-api')
  .setIssuedAt()
  .setExpirationTime('5m')
  .setJti(crypto.randomUUID())
  .sign(key);
process.stdout.write(`${token}\n`);
