import { describe, expect, it } from 'vitest';

import { aggregateHealth, HealthStatusSchema } from './health.js';

describe('aggregateHealth', () => {
  it('is ok when all checks are up', () => {
    const status = aggregateHealth('api', '0.0.0', { db: { status: 'up' } });
    expect(status.status).toBe('ok');
    expect(HealthStatusSchema.parse(status)).toEqual(status);
  });

  it('is error when any check is down', () => {
    expect(aggregateHealth('api', '0.0.0', { db: { status: 'down' } }).status).toBe('error');
  });

  it('is ok with no checks (liveness)', () => {
    expect(aggregateHealth('api', '0.0.0', {}).status).toBe('ok');
  });
});
