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
