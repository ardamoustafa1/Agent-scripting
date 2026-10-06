import { describe, expect, it, vi } from 'vitest';

import { RuntimeJobsService } from './runtime-jobs.service.js';

import type { TransactionClient } from '../../infra/database/prisma.service.js';
import type { EventEnvelope } from '../../infra/outbox/outbox.types.js';

const queues = vi.hoisted(
  () =>
    new Map<
      string,
      {
        add: ReturnType<typeof vi.fn>;
        getJobCounts: ReturnType<typeof vi.fn>;
        getFailedCount: ReturnType<typeof vi.fn>;
      }
    >(),
);
vi.mock('bullmq', () => ({
  Queue: class {
    add = vi.fn().mockResolvedValue({});
    getJobCounts = vi.fn().mockResolvedValue({ waiting: 3, active: 1, delayed: 2 });
    getFailedCount = vi.fn().mockResolvedValue(0);
    constructor(name: string) {
      queues.set(name, this);
    }
    on() {
      return this;
    }
  },
  Worker: vi.fn(),
}));

const uuid = '01928f3a-0000-7000-8000-000000000001';
function fixture() {
  queues.clear();
  const connection = { on: vi.fn() };
  const args = [
    { client: { duplicate: () => connection } },
    { EVENT_CONSUMERS_ENABLED: false },
    {},
    {},
    {},
    {},
    {},
  ] as unknown as ConstructorParameters<typeof RuntimeJobsService>;
  return new RuntimeJobsService(...args);
}
function event(type: string): EventEnvelope {
  return {
    id: uuid,
    tenantId: uuid,
    type,
    aggregate: { id: uuid },
    payload: { outcomeId: uuid },
  } as unknown as EventEnvelope;
}
describe('runtime writeback isolation', () => {
  it('routes outcomes to the dedicated queue and expiry to the legacy queue', async () => {
    const service = fixture();
    const tx = {
      session: { findFirst: vi.fn().mockResolvedValue({ expiresAt: new Date(0) }) },
    } as unknown as TransactionClient;
    await service.enqueue(event('verbis.runtime.outcome.submitted.v1'), tx);
    expect(queues.get('runtime-writeback')?.add).toHaveBeenCalledWith(
      'outcome',
      expect.objectContaining({ kind: 'outcome' }),
      expect.objectContaining({ jobId: uuid, attempts: 8 }),
    );
    expect(queues.get('runtime')?.add).not.toHaveBeenCalled();
    await service.enqueue(event('verbis.runtime.session.started.v1'), tx);
    expect(queues.get('runtime')?.add).toHaveBeenCalledWith(
      'expire',
      expect.objectContaining({ kind: 'expire' }),
      expect.objectContaining({ delay: 0 }),
    );
  });
  it('counts only writeback states and emits no false zero on Redis failure', async () => {
    const service = fixture();
    service.writebackQueue();
    const observe = vi.fn();
    await service.sampleWriteback({ observe });
    expect(observe).toHaveBeenCalledWith(6);
    observe.mockClear();
    queues.get('runtime-writeback')?.getJobCounts.mockRejectedValue(new Error('unavailable'));
    await service.sampleWriteback({ observe });
    expect(observe).not.toHaveBeenCalled();
  });
});
