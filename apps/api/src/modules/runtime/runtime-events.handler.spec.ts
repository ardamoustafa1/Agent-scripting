import { expect, it, vi } from 'vitest';

import { RuntimeEventsHandler } from './runtime-events.handler.js';

import type { RuntimeJobsService } from './runtime-jobs.service.js';
import type { RuntimeGateway } from './runtime.gateway.js';
import type { TransactionClient } from '../../infra/database/prisma.service.js';
import type { EventEnvelope } from '../../infra/outbox/outbox.types.js';

it.each([
  'verbis.runtime.session.changed.v1',
  'verbis.runtime.connector.acknowledged.v1',
  'verbis.runtime.outcome.submitted.v1',
])('delivers %s without feeding acknowledgment back into the writeback queue', async (type) => {
  const publish = vi.fn();
  const enqueue = vi.fn().mockResolvedValue(undefined);
  const handler = new RuntimeEventsHandler(
    { publish } as unknown as RuntimeGateway,
    { enqueue } as unknown as RuntimeJobsService,
  );
  const event = {
    type,
    tenantId: 'tenant',
    aggregate: { id: 'session', type: 'Session' },
    payload: { commandId: 'command' },
  } as unknown as EventEnvelope;
  await handler.handle(event, {} as TransactionClient);
  expect(enqueue).toHaveBeenCalledTimes(
    type === 'verbis.runtime.connector.acknowledged.v1' ? 0 : 1,
  );
  expect(publish).toHaveBeenCalledTimes(type === 'verbis.runtime.outcome.submitted.v1' ? 0 : 1);
  expect(handler.filterSubjects).toContain(type);
});
