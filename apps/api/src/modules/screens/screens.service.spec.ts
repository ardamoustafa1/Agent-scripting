import { describe, expect, it, vi } from 'vitest';

import {
  assertCan,
  defineAbilityFor,
  SYSTEM_ROLES,
  type Action,
  type AppSubject,
} from '@verbis/authz';

import { ScreenListQuerySchema } from './screens.dto.js';
import { ScreensService } from './screens.service.js';

import type { ScreensRepository } from './screens.repository.js';
import type { TenantDb } from '../../infra/database/tenant-db.js';
import type { AuthzService } from '../authz/authz.service.js';

function fixture(campaign: string) {
  const ability = defineAbilityFor({
    userId: 'scoped-agent',
    grants: [{ rules: SYSTEM_ROLES.agent.rules, scope: { campaignIds: ['allowed-campaign'] } }],
  });
  const version = vi.fn().mockResolvedValue({ scriptId: 'shared-script' });
  const assignments = vi.fn().mockResolvedValue([{ campaignId: campaign }]);
  const list = vi.fn().mockResolvedValue([]);
  const find = vi
    .fn()
    .mockResolvedValue({ id: 'screen', scriptVersionId: 'version', props: 'must not leak' });
  const db = {
    current: () => ({
      scriptVersion: { findFirst: version },
      assignment: { findMany: assignments },
    }),
    tenantId: () => 'current-tenant',
  } as unknown as TenantDb;
  const authz = {
    authorize: (action: Action, target: AppSubject) => {
      assertCan(ability, action, target);
    },
  } as unknown as AuthzService;
  const service = new ScreensService(db, { list, find } as unknown as ScreensRepository, authz);
  return { service, list, version, assignments };
}
describe('screen instance campaign authorization', () => {
  it('denies another campaign before listing any screen rows', async () => {
    const { service, list } = fixture('foreign-campaign');
    await expect(service.list('version', ScreenListQuerySchema.parse({}))).rejects.toThrow();
    expect(list).not.toHaveBeenCalled();
  });
  it('denies direct screen ID reads from another campaign', async () => {
    await expect(fixture('foreign-campaign').service.get('screen')).rejects.toThrow();
  });
  it('accepts an allowed campaign and always scopes metadata lookups to the trusted tenant', async () => {
    const { service, list, version, assignments } = fixture('allowed-campaign');
    await service.list('version', ScreenListQuerySchema.parse({}));
    expect(list).toHaveBeenCalled();
    expect(version).toHaveBeenCalledWith({
      where: {
        id: 'version',
        tenantId: 'current-tenant',
        deletedAt: null,
        script: { deletedAt: null },
      },
      select: { scriptId: true },
    });
    expect(assignments).toHaveBeenCalledWith({
      where: { tenantId: 'current-tenant', scriptId: 'shared-script', deletedAt: null },
      select: { campaignId: true },
    });
  });
});
