import { z } from 'zod';

import { randomToken, sha256Hex } from '../crypto/random.js';

import type { Keyring } from '../crypto/keyring.js';
import type { Redis } from 'ioredis';

/** In-flight login (between redirect to the IdP and the callback). Single use, 10 minutes. */
export const LoginTransactionSchema = z.object({
  tenantId: z.uuid(),
  tenantSlug: z.string(),
  idpId: z.uuid(),
  protocol: z.enum(['oidc', 'saml']),
  app: z.string(),
  returnTo: z.string(),
  callbackUrl: z.string(),
  /** Browser binding: hash of the transaction cookie value. */
  browserBinding: z.string(),
  createdAt: z.number().int(),
  oidc: z.object({ state: z.string(), nonce: z.string(), codeVerifier: z.string() }).optional(),
  saml: z.object({ requestId: z.string() }).optional(),
});
export type LoginTransaction = z.infer<typeof LoginTransactionSchema>;

export const LOGIN_TRANSACTION_TTL_SECONDS = 600;

const txKey = (handle: string) => `idn:ltx:${sha256Hex(handle)}`;

/**
 * Login transactions in Redis, sealed, keyed by the OIDC `state` / SAML `RelayState` handle.
 * `take` is atomic (GETDEL): a callback can be processed at most once (code/assertion replay).
 */
export class LoginTransactions {
  constructor(
    private readonly redis: Redis,
    private readonly keyring: Keyring,
  ) {}

  /** Returns the opaque handle used as OIDC `state` or SAML `RelayState`. */
  async put(transaction: LoginTransaction, handle = randomToken(32)): Promise<string> {
    const key = txKey(handle);
    await this.redis.set(
      key,
      this.keyring.seal(JSON.stringify(transaction), key),
      'EX',
      LOGIN_TRANSACTION_TTL_SECONDS,
    );
    return handle;
  }

  async take(handle: string | undefined): Promise<LoginTransaction | undefined> {
    if (handle === undefined || !/^[A-Za-z0-9_-]{20,128}$/.test(handle)) return undefined;
    const key = txKey(handle);
    const sealed = await this.redis.getdel(key);
    if (sealed === null) return undefined;
    try {
      const parsed = LoginTransactionSchema.safeParse(
        JSON.parse(this.keyring.openString(sealed, key)),
      );
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  /** One-time markers (assertion ids, logout-token jti) for replay protection. */
  async markOnce(namespace: string, id: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.redis.set(
      `idn:once:${namespace}:${sha256Hex(id)}`,
      '1',
      'EX',
      Math.max(1, ttlSeconds),
      'NX',
    );
    return result === 'OK';
  }
}
