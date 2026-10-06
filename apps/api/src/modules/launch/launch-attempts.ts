import { Inject, Injectable } from '@nestjs/common';

import { RedisService } from '../../infra/redis/redis.service.js';

/**
 * Failed-launch accounting (SECURITY §4.4 item 9): per user and per IP in a sliding window. Past
 * `ANOMALY_THRESHOLD` failures an anomaly is raised (once per window); past `BLOCK_THRESHOLD`
 * further attempts are refused before any lookup. Redis outage ⇒ the limiter fails open (the
 * launch checks themselves still fail closed), and the global rate limit still applies.
 */
export const FAILURE_WINDOW_SECONDS = 300;
export const ANOMALY_THRESHOLD = 5;
export const BLOCK_THRESHOLD = 10;

export interface AttemptKey {
  readonly tenantId: string;
  readonly userId: string;
  readonly ip: string;
}

const keys = (k: AttemptKey) => [
  `launch:fail:u:${k.tenantId}:${k.userId}`,
  `launch:fail:ip:${k.ip}`,
];

@Injectable()
export class LaunchAttempts {
  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  async blocked(key: AttemptKey): Promise<boolean> {
    try {
      const counts = await this.redis.client.mget(...keys(key));
      return counts.some((count) => Number(count ?? 0) >= BLOCK_THRESHOLD);
    } catch {
      return false;
    }
  }

  /** Records a failure; returns true exactly when this failure crosses the anomaly threshold. */
  async fail(key: AttemptKey): Promise<{ anomaly: boolean; count: number }> {
    try {
      const pipeline = this.redis.client.multi();
      for (const k of keys(key)) pipeline.incr(k).expire(k, FAILURE_WINDOW_SECONDS, 'NX');
      const results = (await pipeline.exec()) ?? [];
      const counts = [results[0]?.[1], results[2]?.[1]].map((value) => Number(value ?? 0));
      const count = Math.max(...counts);
      return { anomaly: counts.includes(ANOMALY_THRESHOLD), count };
    } catch {
      return { anomaly: false, count: 0 };
    }
  }
}
