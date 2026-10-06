import { expect, it, vi } from 'vitest';

import { createAbility } from '@verbis/authz';

import { AnalyticsService } from './analytics.service.js';
import { fixtureFact, fixtureId } from './fixtures.js';

import type { AnalyticsRepository } from './analytics.repository.js';
import type { AnalyticsStore } from './storage.js';
import type { TenantDb } from '../../infra/database/tenant-db.js';
import type { AuditService } from '../audit/audit.service.js';
import type { AuthzService } from '../authz/authz.service.js';

it('applies scoped and inverted Report rules BEFORE aggregating and hides agent comparisons', async () => {
  const facts = [
    fixtureFact(0),
    fixtureFact(1, { state: 'completed' }),
    fixtureFact(2, { type: 'start', sessionId: fixtureId(20), campaignId: fixtureId(55) }),
    fixtureFact(3, { state: 'abandoned', sessionId: fixtureId(20), campaignId: fixtureId(55) }),
  ];
  const ability = createAbility([
    { action: 'read', subject: 'Report', conditions: { teamId: fixtureId(6) } },
    {
      action: 'read',
      subject: 'Report',
      conditions: { campaignId: fixtureId(55) },
      inverted: true,
    },
  ]);
  const service = new AnalyticsService(
    { read: vi.fn().mockResolvedValue(facts) } as unknown as AnalyticsStore,
    {
      can: (...args: Parameters<typeof ability.can>) => ability.can(...args),
    } as unknown as AuthzService,
    {} as AuditService,
    { current: () => ({}), tenantId: () => fixtureId(1) } as unknown as TenantDb,
    {} as AnalyticsRepository,
  );
  const result = await service.dashboard({ from: '2026-10-03', to: '2026-10-03' });
  expect(result.sessions).toBe(1);
  expect(result.completionRate).toBe(1);
  expect(result.agents).toEqual([]);
  expect(result.active).toEqual([]);
});

it('does not recommend outcomes outside the authorized campaign scope', async () => {
  const ability = createAbility([
    { action: 'read', subject: 'Report', conditions: { campaignId: fixtureId(999) } },
  ]);
  const service = new AnalyticsService(
    {
      read: vi
        .fn()
        .mockResolvedValue([fixtureFact(0, { experimentId: fixtureId(100), variant: 'a' })]),
    } as unknown as AnalyticsStore,
    {
      can: (...args: Parameters<typeof ability.can>) => ability.can(...args),
    } as unknown as AuthzService,
    {} as AuditService,
    { current: () => ({}), tenantId: () => fixtureId(1) } as unknown as TenantDb,
    {} as AnalyticsRepository,
  );
  expect(await service.recommendations({ from: '2026-10-03', to: '2026-10-03' })).toEqual({
    data: [],
  });
});

it('recommends only complete, significant outcomes and refuses missing start evidence', async () => {
  const facts = Array.from({ length: 200 }, (_, index) => {
    const common = {
      sessionId: fixtureId(index + 1000),
      experimentId: fixtureId(100),
      variant: index < 100 ? 'a' : 'b',
    };
    return [
      fixtureFact(index * 2, { ...common, type: 'start', state: 'launching' }),
      fixtureFact(index * 2 + 1, {
        ...common,
        type: 'state',
        state:
          index < 100
            ? index < 40
              ? 'completed'
              : 'abandoned'
            : index < 190
              ? 'completed'
              : 'abandoned',
      }),
    ];
  }).flat();
  const read = vi.fn().mockResolvedValue(facts);
  const service = new AnalyticsService(
    { read } as unknown as AnalyticsStore,
    { can: () => true } as unknown as AuthzService,
    {} as AuditService,
    { current: () => ({}), tenantId: () => fixtureId(1) } as unknown as TenantDb,
    {} as AnalyticsRepository,
  );
  expect(await service.recommendations({ from: '2026-10-03', to: '2026-10-03' })).toMatchObject({
    data: [{ recommended: 'b', reason: 'ok' }],
  });
  read.mockResolvedValue(facts.filter((fact) => fact.type !== 'start'));
  expect(await service.recommendations({ from: '2026-10-03', to: '2026-10-03' })).toMatchObject({
    data: [{ recommended: null, reason: 'data-loss' }],
  });
});
