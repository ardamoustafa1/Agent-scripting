import { describe, expect, it, vi } from 'vitest';

import { EventConsumersService, isConsumerExists } from './event-consumers.service.js';

import type { EventHandler } from './event-consumer.js';

describe('isConsumerExists', () => {
  it('recognises the JetStream "consumer already exists" answer by code or message only', () => {
    expect(isConsumerExists({ apiError: () => ({ err_code: 10148 }) })).toBe(true);
    expect(isConsumerExists(new Error('consumer already exists'))).toBe(true);
    expect(isConsumerExists(new Error('Consumer Already Exists'))).toBe(true);
    expect(isConsumerExists({ apiError: () => ({ err_code: 10059 }) })).toBe(false);
    expect(isConsumerExists(new Error('stream not found'))).toBe(false);
    expect(isConsumerExists(null)).toBe(false);
    expect(isConsumerExists('consumer already exists')).toBe(false);
  });
});

const handler: EventHandler = {
  name: 'fixture-consumer',
  stream: 'FIXTURE',
  filterSubjects: ['verbis.fixture.>'],
  handle: vi.fn(),
};

function service(add: ReturnType<typeof vi.fn>, update: ReturnType<typeof vi.fn>) {
  const messages = {
    close: vi.fn().mockResolvedValue(undefined),

    async *[Symbol.asyncIterator]() {
      /* no messages */
    },
  };
  const nats = {
    ensureStreams: vi.fn().mockResolvedValue(undefined),
    manager: vi.fn().mockResolvedValue({ consumers: { add, update } }),
    jetstream: vi.fn().mockResolvedValue({
      consumers: {
        get: vi.fn().mockResolvedValue({ consume: vi.fn().mockResolvedValue(messages) }),
      },
    }),
  };
  return new EventConsumersService(
    { EVENT_CONSUMERS_ENABLED: true } as never,
    nats as never,
    { run: vi.fn() } as never,
    { getProviders: () => [] } as never,
  );
}

describe('EventConsumersService.start', () => {
  it('creates the durable consumer', async () => {
    const add = vi.fn().mockResolvedValue({}),
      update = vi.fn();
    await service(add, update).start(handler);
    expect(add).toHaveBeenCalledWith(
      'FIXTURE',
      expect.objectContaining({ durable_name: 'fixture-consumer' }),
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('updates a consumer left behind by an earlier configuration instead of failing', async () => {
    const add = vi.fn().mockRejectedValue(new Error('consumer already exists')),
      update = vi.fn().mockResolvedValue({});
    await service(add, update).start(handler);
    expect(update).toHaveBeenCalledWith(
      'FIXTURE',
      'fixture-consumer',
      expect.objectContaining({ filter_subjects: ['verbis.fixture.>'] }),
    );
  });

  it('still fails on other errors, so the retry loop can report them', async () => {
    const add = vi.fn().mockRejectedValue(new Error('stream not found'));
    await expect(service(add, vi.fn()).start(handler)).rejects.toThrow('stream not found');
  });
});
