import { expect, it, vi } from 'vitest';

import { SharedScreensService } from './shared-screens.service.js';

import type { TenantDb } from '../../infra/database/tenant-db.js';
import type { OutboxWriter } from '../../infra/outbox/outbox.writer.js';
import type { AuditService } from '../audit/audit.service.js';
import type { AuthzService } from '../authz/authz.service.js';

it('counts hidden campaigns without leaking their identifiers or unauthorized script details', async () => {
  const tx = {
    sharedScreenVersion: { findFirst: vi.fn().mockResolvedValue({ number: 2, semver: '2.0.0' }) },
    scriptScreenLink: {
      findMany: vi.fn().mockResolvedValue(
        ['allowed', 'hidden'].map((id) => ({
          sharedScreenVersion: { number: 1, semver: '1.0.0' },
          scriptVersion: {
            id: `${id}-version`,
            number: 1,
            state: 'published',
            semver: '1.0.0',
            script: { id, name: id },
          },
        })),
      ),
    },
    assignment: {
      findMany: vi.fn().mockResolvedValue([
        { scriptId: 'allowed', campaignId: 'visible-campaign', campaign: { name: 'Visible' } },
        { scriptId: 'allowed', campaignId: 'secret-campaign', campaign: { name: 'Secret name' } },
        { scriptId: 'hidden', campaignId: 'secret-campaign', campaign: { name: 'Secret name' } },
      ]),
    },
  };
  const can = vi.fn((_action: string, target: Record<string, unknown>) =>
    target['__caslSubjectType__'] === 'Script'
      ? target['id'] === 'allowed'
      : target['id'] === 'visible-campaign',
  );
  const service = new SharedScreensService(
    { current: () => tx, tenantId: () => 'tenant' } as unknown as TenantDb,
    {} as AuditService,
    {} as OutboxWriter,
    { can } as unknown as AuthzService,
  );
  const result = await service.impact('screen');
  expect(result.hiddenCampaignCount).toBe(1);
  expect(result.campaigns).toEqual([{ id: 'visible-campaign', name: 'Visible' }]);
  expect(result.affected).toMatchObject([{ scriptId: 'allowed', outdated: true }]);
  expect(JSON.stringify(result)).not.toContain('Secret name');
  expect(JSON.stringify(result)).not.toContain('secret-campaign');
  expect(JSON.stringify(result)).not.toContain('hidden-version');
  expect(tx.assignment.findMany.mock.calls[0]).toMatchObject([{ where: { tenantId: 'tenant' } }]);
});
