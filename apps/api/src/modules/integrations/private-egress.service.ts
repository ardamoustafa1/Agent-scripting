import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { Inject, Injectable } from '@nestjs/common';

import { requestContext } from '../../common/context/request-context.js';
import { ForbiddenError, NotFoundError } from '../../common/errors/domain-errors.js';
import { API_ENV, type ApiEnv } from '../../env.js';
import { RedisService } from '../../infra/redis/redis.service.js';
import { Keyring } from '../identity/crypto/keyring.js';
import { safeEqual } from '../identity/crypto/random.js';

import { GatewayCommandSchema, GatewayJobSchema } from './engine/gateway-contracts.js';
import { IntegrationError } from './engine/transport.js';

import type { GatewayCommand, GatewayCompletion } from './engine/gateway-contracts.js';

/** Outbound-only pull bridge. Transient request/results are sealed, bounded and never replayed. */
@Injectable()
export class PrivateEgressService {
  private readonly keys: Keyring;
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {
    this.keys = new Keyring(env.IDENTITY_ENCRYPTION_KEYS).derive('private-egress');
  }
  private slot(tenant: string, client: string, id: string, kind: string) {
    return `private-egress:${tenant}:${client}:${id}:${kind}`;
  }
  private worker() {
    const p = requestContext.require().principal;
    if (
      !this.env.PRIVATE_EGRESS_ENABLED ||
      p?.type !== 'service' ||
      !p.certificateThumbprint ||
      !p.id.startsWith('svc:') ||
      !p.scopes.includes('execute:Integration')
    )
      throw new ForbiddenError();
    return { tenant: p.tenantId, client: p.id.slice(4) };
  }
  async dispatch(
    tenant: string,
    client: string,
    target: string,
    command: GatewayCommand,
    timeoutMs: number,
    maxResponseBytes: number,
    signal: AbortSignal,
  ) {
    if (!this.env.PRIVATE_EGRESS_ENABLED) throw new IntegrationError('GATEWAY_DISABLED');
    signal.throwIfAborted();
    const id = randomUUID(),
      lease = randomBytes(32).toString('hex');
    const job = GatewayJobSchema.parse({
      id,
      lease,
      target,
      command: GatewayCommandSchema.parse(command),
      deadline: Date.now() + timeoutMs,
      maxResponseBytes,
    });
    const queue = this.slot(tenant, client, 'queue', 'ids');
    const request = this.slot(tenant, client, id, 'request');
    const lock = this.slot(tenant, client, id, 'lease');
    const result = this.slot(tenant, client, id, 'result');
    const ttl = Math.ceil(timeoutMs / 1000) + 1;
    const metadata = JSON.stringify({ lease, maxResponseBytes, deadline: job.deadline });
    try {
      const accepted = await this.redis.client.eval(
        `
        if redis.call('LLEN', KEYS[1]) >= 1000 then return 0 end
        redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[4])
        redis.call('SET', KEYS[3], ARGV[3], 'EX', ARGV[4])
        redis.call('RPUSH', KEYS[1], ARGV[1])
        redis.call('EXPIRE', KEYS[1], 120)
        return 1`,
        3,
        queue,
        request,
        lock,
        id,
        this.keys.seal(JSON.stringify(job), request),
        metadata,
        ttl,
      );
      if (accepted !== 1) throw new IntegrationError('GATEWAY_BUSY');
      while (Date.now() < job.deadline) {
        signal.throwIfAborted();
        const sealed = await this.redis.client.getdel(result);
        if (sealed !== null) {
          const response = JSON.parse(
            this.keys.openString(sealed, result),
          ) as GatewayCompletion['response'];
          return { ...response, headers: {} };
        }
        await delay(25, undefined, { signal });
      }
      throw new IntegrationError('TIMEOUT', true);
    } finally {
      // Also removes stale queue entries when the request is cancelled before a worker claims it.
      await this.redis.client.multi().del(request, lock, result).lrem(queue, 0, id).exec();
    }
  }
  async claim() {
    const { tenant, client } = this.worker();
    const queue = this.slot(tenant, client, 'queue', 'ids');
    for (let n = 0; n < 100; n++) {
      const id = await this.redis.client.lpop(queue);
      if (id === null) return null;
      const request = this.slot(tenant, client, id, 'request');
      const sealed = await this.redis.client.getdel(request);
      if (sealed === null) continue;
      const job = GatewayJobSchema.parse(JSON.parse(this.keys.openString(sealed, request)));
      if (job.deadline > Date.now()) return job;
    }
    return null;
  }
  async complete(id: string, input: GatewayCompletion) {
    const { tenant, client } = this.worker();
    const lock = this.slot(tenant, client, id, 'lease'),
      result = this.slot(tenant, client, id, 'result');
    const raw = await this.redis.client.get(lock);
    if (raw === null) throw new NotFoundError('Gateway job');
    const metadata = JSON.parse(raw) as {
      lease: string;
      maxResponseBytes: number;
      deadline: number;
    };
    if (!safeEqual(input.lease, metadata.lease) || metadata.deadline <= Date.now())
      throw new ForbiddenError();
    if (Buffer.byteLength(input.response.body) > metadata.maxResponseBytes)
      throw new ForbiddenError();
    const sealed = this.keys.seal(JSON.stringify(input.response), result);
    const accepted = await this.redis.client.eval(
      `
      if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
      redis.call('DEL', KEYS[1])
      redis.call('SET', KEYS[2], ARGV[2], 'EX', 15)
      return 1`,
      2,
      lock,
      result,
      raw,
      sealed,
    );
    if (accepted !== 1) throw new NotFoundError('Gateway job');
  }
}
