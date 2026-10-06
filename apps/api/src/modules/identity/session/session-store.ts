import { uuidv7 } from '../../../common/crypto/uuid.js';
import { type Keyring, SealedDataError } from '../crypto/keyring.js';
import { randomToken, sha256Hex } from '../crypto/random.js';

import {
  type NewSession,
  type SessionPolicy,
  type SessionRecord,
  SessionRecordSchema,
} from './session.types.js';

import type { Redis } from 'ioredis';

export class ConcurrentSessionLimitError extends Error {
  override readonly name = 'ConcurrentSessionLimitError';
}

/** Touch the idle timer at most once per this interval (fewer Redis writes per request). */
const TOUCH_INTERVAL_MS = 60_000;
const LOCK_TTL_MS = 5_000;

const key = {
  session: (hash: string) => `idn:sess:${hash}`,
  user: (tenantId: string, userId: string) => `idn:usr:${tenantId}:${userId}`,
  oidcSid: (tenantId: string, idpId: string, sid: string) =>
    `idn:sid:${tenantId}:${idpId}:${sha256Hex(sid)}`,
  oidcSub: (tenantId: string, idpId: string, sub: string) =>
    `idn:sub:${tenantId}:${idpId}:${sha256Hex(sub)}`,
  samlName: (tenantId: string, idpId: string, nameId: string) =>
    `idn:saml:${tenantId}:${idpId}:${sha256Hex(nameId)}`,
  idp: (tenantId: string, idpId: string) => `idn:idp:${tenantId}:${idpId}`,
  lock: (name: string) => `idn:lock:${name}`,
};

export interface CreatedSession {
  /** Cookie value (256-bit random); only its SHA-256 is used as a Redis key. */
  readonly token: string;
  readonly record: SessionRecord;
  readonly evicted: readonly SessionRecord[];
}

export interface LoadedSession {
  readonly hash: string;
  readonly record: SessionRecord;
}

/**
 * Redis-backed session store. Records are sealed with the identity keyring (AAD = Redis key), so
 * a Redis dump reveals neither tokens nor cookie values. Expiry: the key TTL is the idle timeout,
 * capped by the absolute timeout; both are also checked on read (fail closed on clock drift).
 */
export class SessionStore {
  constructor(
    private readonly redis: Redis,
    private readonly keyring: Keyring,
    private readonly now: () => number = Date.now,
  ) {}

  static hashToken(token: string): string {
    return sha256Hex(token);
  }

  /** Revalidate a WebSocket grant without retaining the browser cookie. */
  async loadHash(hash: string): Promise<SessionRecord | undefined> {
    if (!/^[a-f0-9]{64}$/.test(hash)) return undefined;
    const record = await this.read(hash);
    if (
      record === undefined ||
      this.now() >= record.absoluteExpiresAt ||
      this.now() >= record.lastSeenAt + record.idleTimeoutSeconds * 1000
    )
      return undefined;
    return record;
  }

  async create(input: NewSession, policy: SessionPolicy): Promise<CreatedSession> {
    const now = this.now();
    const token = randomToken(32);
    const hash = SessionStore.hashToken(token);
    const record: SessionRecord = SessionRecordSchema.parse({
      ...input,
      v: 1,
      id: uuidv7(now),
      createdAt: now,
      lastSeenAt: now,
      absoluteExpiresAt: now + policy.absoluteTimeoutSeconds * 1000,
      idleTimeoutSeconds: policy.idleTimeoutSeconds,
      csrfToken: randomToken(32),
    });
    const userKey = key.user(record.tenantId, record.userId);
    const evicted = await this.withLock(`usr:${record.tenantId}:${record.userId}`, async () => {
      const live = await this.liveMembers(userKey);
      const removed: SessionRecord[] = [];
      if (live.length >= policy.maxConcurrent) {
        if (policy.onLimit === 'deny') throw new ConcurrentSessionLimitError();
        // Oldest first (sorted set score = creation time).
        for (const member of live.slice(0, live.length - policy.maxConcurrent + 1)) {
          const old = await this.revokeHash(member.hash);
          if (old !== undefined) removed.push(old);
        }
      }
      await this.write(hash, record);
      await this.redis
        .multi()
        .zadd(userKey, record.createdAt, hash)
        .pexpire(userKey, policy.absoluteTimeoutSeconds * 1000 + 60_000)
        .exec();
      await this.index(hash, record);
      return removed;
    });
    return { token, record, evicted };
  }

  /** Returns the live session for a cookie value, or undefined (expired sessions are removed). */
  async load(token: string): Promise<LoadedSession | undefined> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
    const hash = SessionStore.hashToken(token);
    const record = await this.read(hash);
    if (record === undefined) return undefined;
    const now = this.now();
    if (
      now >= record.absoluteExpiresAt ||
      now >= record.lastSeenAt + record.idleTimeoutSeconds * 1000
    ) {
      await this.revokeHash(hash);
      return undefined;
    }
    if (now - record.lastSeenAt >= TOUCH_INTERVAL_MS) {
      const touched = { ...record, lastSeenAt: now };
      await this.write(hash, touched);
      return { hash, record: touched };
    }
    return { hash, record };
  }

  async update(hash: string, record: SessionRecord): Promise<void> {
    if ((await this.redis.exists(key.session(hash))) === 0) return;
    await this.write(hash, record);
    await this.index(hash, record);
  }

  async revokeHash(hash: string): Promise<SessionRecord | undefined> {
    const record = await this.read(hash);
    await this.redis.del(key.session(hash));
    if (record !== undefined) {
      const pipeline = this.redis.multi().zrem(key.user(record.tenantId, record.userId), hash);
      if (record.idpId !== undefined) pipeline.srem(key.idp(record.tenantId, record.idpId), hash);
      if (record.idpId !== undefined && record.oidc?.sid !== undefined)
        pipeline.srem(key.oidcSid(record.tenantId, record.idpId, record.oidc.sid), hash);
      if (record.idpId !== undefined && record.oidc !== undefined)
        pipeline.srem(key.oidcSub(record.tenantId, record.idpId, record.oidc.sub), hash);
      if (record.idpId !== undefined && record.saml !== undefined)
        pipeline.srem(key.samlName(record.tenantId, record.idpId, record.saml.nameId), hash);
      await pipeline.exec();
    }
    return record;
  }

  async listForUser(tenantId: string, userId: string): Promise<LoadedSession[]> {
    const members = await this.liveMembers(key.user(tenantId, userId));
    return members.filter((member) => member.record.tenantId === tenantId);
  }

  async revokeById(
    tenantId: string,
    userId: string,
    id: string,
  ): Promise<SessionRecord | undefined> {
    const match = (await this.listForUser(tenantId, userId)).find((s) => s.record.id === id);
    return match === undefined ? undefined : this.revokeHash(match.hash);
  }

  async revokeAllForUser(
    tenantId: string,
    userId: string,
    options: { exceptId?: string } = {},
  ): Promise<SessionRecord[]> {
    const revoked: SessionRecord[] = [];
    for (const session of await this.listForUser(tenantId, userId)) {
      if (session.record.id === options.exceptId) continue;
      const record = await this.revokeHash(session.hash);
      if (record !== undefined) revoked.push(record);
    }
    return revoked;
  }

  /** OIDC back-/front-channel logout by IdP session id (`sid`). */
  revokeByOidcSid(tenantId: string, idpId: string, sid: string): Promise<SessionRecord[]> {
    return this.revokeSet(key.oidcSid(tenantId, idpId, sid), tenantId);
  }

  /** OIDC back-channel logout by subject (no `sid` in the logout token). */
  revokeByOidcSubject(tenantId: string, idpId: string, sub: string): Promise<SessionRecord[]> {
    return this.revokeSet(key.oidcSub(tenantId, idpId, sub), tenantId);
  }

  /** Every session established through an IdP (IdP disabled, deleted or compromised). */
  revokeByIdp(tenantId: string, idpId: string): Promise<SessionRecord[]> {
    return this.revokeSet(key.idp(tenantId, idpId), tenantId);
  }

  /** SAML IdP-initiated SLO: NameID, optionally narrowed to the given SessionIndex values. */
  async revokeBySaml(
    tenantId: string,
    idpId: string,
    nameId: string,
    sessionIndexes: readonly string[],
  ): Promise<SessionRecord[]> {
    const setKey = key.samlName(tenantId, idpId, nameId);
    const revoked: SessionRecord[] = [];
    for (const hash of await this.redis.smembers(setKey)) {
      const record = await this.read(hash);
      if (record === undefined) {
        await this.redis.srem(setKey, hash);
        continue;
      }
      if (record.tenantId !== tenantId || record.saml?.nameId !== nameId) continue;
      if (
        sessionIndexes.length > 0 &&
        (record.saml.sessionIndex === undefined ||
          !sessionIndexes.includes(record.saml.sessionIndex))
      )
        continue;
      const removed = await this.revokeHash(hash);
      if (removed !== undefined) revoked.push(removed);
    }
    return revoked;
  }

  /** Mutual exclusion per session (refresh-token rotation must not run twice concurrently). */
  async tryLock(name: string, ttlMs = LOCK_TTL_MS): Promise<(() => Promise<void>) | undefined> {
    const lockKey = key.lock(name);
    const owner = randomToken(12);
    const acquired = await this.redis.set(lockKey, owner, 'PX', ttlMs, 'NX');
    if (acquired !== 'OK') return undefined;
    return async () => {
      // Release only our own lock.
      await this.redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        lockKey,
        owner,
      );
    };
  }

  private async withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const release = await this.tryLock(name);
      if (release !== undefined) {
        try {
          return await fn();
        } finally {
          await release();
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 20 + attempt * 5));
    }
    throw new Error('could not acquire session lock');
  }

  private async revokeSet(setKey: string, tenantId: string): Promise<SessionRecord[]> {
    const revoked: SessionRecord[] = [];
    for (const hash of await this.redis.smembers(setKey)) {
      const record = await this.read(hash);
      if (record?.tenantId !== tenantId) continue;
      const removed = await this.revokeHash(hash);
      if (removed !== undefined) revoked.push(removed);
    }
    await this.redis.del(setKey);
    return revoked;
  }

  private async liveMembers(userKey: string): Promise<LoadedSession[]> {
    const hashes = await this.redis.zrange(userKey, 0, '-1');
    const live: LoadedSession[] = [];
    const now = this.now();
    for (const hash of hashes) {
      const record = await this.read(hash);
      if (
        record === undefined ||
        now >= record.absoluteExpiresAt ||
        now >= record.lastSeenAt + record.idleTimeoutSeconds * 1000
      ) {
        await this.redis.zrem(userKey, hash);
        if (record !== undefined) await this.redis.del(key.session(hash));
        continue;
      }
      live.push({ hash, record });
    }
    return live;
  }

  private async index(hash: string, record: SessionRecord): Promise<void> {
    if (record.idpId === undefined) return;
    const ttl = Math.max(1000, record.absoluteExpiresAt - this.now() + 60_000);
    const pipeline = this.redis.multi();
    const add = (setKey: string) => pipeline.sadd(setKey, hash).pexpire(setKey, ttl);
    add(key.idp(record.tenantId, record.idpId));
    if (record.oidc?.sid !== undefined)
      add(key.oidcSid(record.tenantId, record.idpId, record.oidc.sid));
    if (record.oidc !== undefined) add(key.oidcSub(record.tenantId, record.idpId, record.oidc.sub));
    if (record.saml !== undefined)
      add(key.samlName(record.tenantId, record.idpId, record.saml.nameId));
    await pipeline.exec();
  }

  private async write(hash: string, record: SessionRecord): Promise<void> {
    const redisKey = key.session(hash);
    const now = this.now();
    const ttlMs = Math.max(
      1000,
      Math.min(
        record.idleTimeoutSeconds * 1000 - (now - record.lastSeenAt),
        record.absoluteExpiresAt - now,
      ),
    );
    await this.redis.set(
      redisKey,
      this.keyring.seal(JSON.stringify(record), redisKey),
      'PX',
      ttlMs,
    );
  }

  private async read(hash: string): Promise<SessionRecord | undefined> {
    const redisKey = key.session(hash);
    const sealed = await this.redis.get(redisKey);
    if (sealed === null) return undefined;
    try {
      const parsed = SessionRecordSchema.safeParse(
        JSON.parse(this.keyring.openString(sealed, redisKey)),
      );
      return parsed.success ? parsed.data : undefined;
    } catch (error) {
      if (error instanceof SealedDataError || error instanceof SyntaxError) return undefined;
      throw error;
    }
  }
}
