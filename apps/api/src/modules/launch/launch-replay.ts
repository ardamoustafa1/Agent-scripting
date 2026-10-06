import { Inject, Injectable } from '@nestjs/common';

import { RedisService } from '../../infra/redis/redis.service.js';

import { CLOCK_SKEW_SECONDS, LaunchDeniedError, MAX_LAUNCH_TTL_SECONDS } from './domain/launch.js';

/**
 * Single use of external JWS `jti` (SECURITY §4.4 item 4): atomic `SET NX` with a TTL longer than
 * any acceptable token. The `launch_intents (tenant_id, jti)` unique index is the durable second
 * line if Redis loses the key. Redis unavailable ⇒ deny (fail closed).
 */
@Injectable()
export class LaunchReplayGuard {
  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  async consume(tenantId: string, issuer: string, jti: string): Promise<void> {
    let result: string | null;
    try {
      result = await this.redis.client.set(
        `launch:jti:${tenantId}:${Buffer.from(issuer).toString('base64url')}:${jti}`,
        '1',
        'EX',
        (MAX_LAUNCH_TTL_SECONDS + CLOCK_SKEW_SECONDS) * 2,
        'NX',
      );
    } catch {
      throw new LaunchDeniedError('token_invalid');
    }
    if (result !== 'OK') throw new LaunchDeniedError('code_replayed');
  }
}
