import { expect, it, vi } from 'vitest';

import { fixtureFact, fixtureId } from './fixtures.js';
import { AnalyticsSessionConsumer, pseudonym } from './session.consumer.js';

import type { AnalyticsStore } from './storage.js';
import type { ApiEnv } from '../../env.js';
import type { TransactionClient } from '../../infra/database/prisma.service.js';

const key = Buffer.alloc(32, 9).toString('base64');
it('pseudonyms are stable, tenant-separated, and not raw IDs', () => {
  expect(pseudonym(key, fixtureId(1), fixtureId(9))).toBe(
    pseudonym(key, fixtureId(1), fixtureId(9)),
  );
  expect(pseudonym(key, fixtureId(1), fixtureId(9))).not.toBe(
    pseudonym(key, fixtureId(2), fixtureId(9)),
  );
});
it('projects only fixed metadata and ignores payload values', async () => {
  const append = vi.fn().mockResolvedValue(undefined),
    fact = fixtureFact(0);
  const consumer = new AnalyticsSessionConsumer(
    { ANALYTICS_ENABLED: true, ANALYTICS_PSEUDONYM_KEY: key } as ApiEnv,
    { append } as unknown as AnalyticsStore,
  );
  const tx = {
    session: {
      findFirst: vi.fn().mockResolvedValue({
        id: fact.sessionId,
        userId: fixtureId(9),
        teamId: fact.teamId,
        assignmentId: null,
        decisionTrace: null,
        scriptVersionId: fact.versionId,
        scriptVersion: { scriptId: fact.scriptId },
        interaction: { campaignId: fact.campaignId, channelType: 'voice' },
      }),
    },
  } as unknown as TransactionClient;
  await consumer.handle(
    {
      id: fact.eventId,
      type: 'verbis.runtime.session.changed.v1',
      tenantId: fact.tenantId,
      aggregate: { type: 'Session', id: fact.sessionId },
      occurredAt: fact.at,
      actor: 'user:' + fixtureId(9),
      correlationId: 'test',
      payload: {
        sequence: 0,
        state: 'launching',
        eventType: 'session.created',
        event: {
          ani: 'SECRET',
          variables: { email: 'SECRET', pan: '4111111111111111', cvv: '937' },
          request: { card: '4111111111111111' },
        },
      },
    },
    tx,
  );
  expect(append).toHaveBeenCalledOnce();
  expect(JSON.stringify(append.mock.calls[0]?.[1])).not.toContain('SECRET');
  expect(JSON.stringify(append.mock.calls[0]?.[1])).not.toContain('4111111111111111');
  expect(JSON.stringify(append.mock.calls[0]?.[1])).not.toContain('937');
  expect(JSON.stringify(append.mock.calls[0]?.[1])).not.toContain(fixtureId(9));
});
it('excludes designer simulation sessions', async () => {
  const append = vi.fn(),
    findFirst = vi.fn().mockResolvedValue(null),
    consumer = new AnalyticsSessionConsumer(
      { ANALYTICS_ENABLED: true, ANALYTICS_PSEUDONYM_KEY: key } as ApiEnv,
      { append } as unknown as AnalyticsStore,
    );
  const f = fixtureFact(0);
  await consumer.handle(
    {
      id: f.eventId,
      type: 'verbis.runtime.session.changed.v1',
      tenantId: f.tenantId,
      aggregate: { type: 'Session', id: f.sessionId },
      occurredAt: f.at,
      actor: 'service:test',
      correlationId: 'test',
      payload: { sequence: 0, state: 'launching', eventType: 'session.created', event: {} },
    },
    { session: { findFirst } } as unknown as TransactionClient,
  );
  expect(append).not.toHaveBeenCalled();
  const call: unknown = findFirst.mock.calls[0]?.[0];
  expect(call).toMatchObject({ where: { kind: 'interaction' } });
});

it('does not double-count runtime debugger copies of integration calls', async () => {
  const append = vi.fn(),
    findFirst = vi.fn();
  const f = fixtureFact(0);
  const consumer = new AnalyticsSessionConsumer(
    { ANALYTICS_ENABLED: true, ANALYTICS_PSEUDONYM_KEY: key } as ApiEnv,
    { append } as unknown as AnalyticsStore,
  );
  await consumer.handle(
    {
      id: f.eventId,
      type: 'verbis.runtime.session.changed.v1',
      tenantId: f.tenantId,
      aggregate: { type: 'Session', id: f.sessionId },
      occurredAt: f.at,
      actor: 'service:test',
      correlationId: 'test',
      payload: {
        sequence: 1,
        state: 'active',
        eventType: 'datasource.called',
        event: { name: 'lookup', status: 'success', durationMs: 1 },
      },
    },
    { session: { findFirst } } as unknown as TransactionClient,
  );
  expect(append).not.toHaveBeenCalled();
  expect(findFirst).not.toHaveBeenCalled();
});
