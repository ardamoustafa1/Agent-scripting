import { describe, expect, it, vi } from 'vitest';

import { buildRules, createAbility, SYSTEM_ROLES, type SystemRoleKey } from '@verbis/authz';

import { requestContext, type RequestContext } from '../../common/context/request-context.js';
import {
  ConflictError,
  type DomainError,
  ForbiddenError,
  NotFoundError,
  VersionMismatchError,
} from '../../common/errors/domain-errors.js';

import { AuthzService } from './authz.service.js';
import { RolesService, toRoleDto } from './roles.service.js';

import type { TenantDb } from '../../infra/database/tenant-db.js';
import type { OutboxWriter } from '../../infra/outbox/outbox.writer.js';
import type { AuditService } from '../audit/audit.service.js';

const TENANT = '0199a000-0000-7000-8000-000000000001';
const ROLE_ID = '0199a000-0000-7000-8000-0000000000aa';

function setup(granter: SystemRoleKey, existing: Record<string, unknown> | null = null) {
  const created = {
    id: ROLE_ID,
    name: 'qa',
    description: null,
    isSystem: false,
    permissions: [],
    rules: [],
    version: 1,
  };
  const tx = {
    role: {
      findFirst: vi.fn(() => Promise.resolve(existing)),
      findFirstOrThrow: vi.fn(() =>
        Promise.resolve({ ...created, ...(existing ?? {}), version: 2 }),
      ),
      findMany: vi.fn(() => Promise.resolve([created])),
      create: vi.fn((args: { data: { rules: unknown } }) =>
        Promise.resolve({ ...created, rules: args.data.rules }),
      ),
      updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
    },
    userRole: {
      findFirst: vi.fn(() =>
        Promise.resolve<{ id: string; scope: object; version: number } | null>({
          id: 'link',
          scope: {},
          version: 1,
        }),
      ),
      update: vi.fn(() => Promise.resolve({})),
    },
  };
  const db = { current: () => tx, tenantId: () => TENANT } as unknown as TenantDb;
  const audit = { record: vi.fn(() => Promise.resolve({})) };
  const outbox = { record: vi.fn(() => Promise.resolve()) };
  const service = new RolesService(
    db,
    audit as unknown as AuditService,
    outbox as unknown as OutboxWriter,
    new AuthzService(),
  );
  const rules = buildRules({
    userId: 'u-1',
    grants: [{ rules: SYSTEM_ROLES[granter].rules, scope: {} }],
  });
  const ctx: RequestContext = {
    requestId: 'r',
    correlationId: 'c',
    ip: '',
    userAgent: '',
    principal: { type: 'user', id: 'u-1', tenantId: TENANT, scopes: [] },
    authz: { ability: createAbility(rules), rules, roles: [granter], separationOfDuties: true },
  };
  const inCtx = <T>(fn: () => T): T => requestContext.run(ctx, fn);
  return { service, tx, audit, outbox, inCtx };
}

describe('RolesService', () => {
  it('creates a custom role from the matrix with audit + outbox', async () => {
    const { service, tx, audit, outbox, inCtx } = setup('tenant_admin');
    const dto = await inCtx(() =>
      service.create({
        name: 'qa',
        matrix: { script: { actions: ['read'], scope: 'campaign', revealPii: false } },
      }),
    );
    expect(tx.role.create).toHaveBeenCalledOnce();
    expect(dto.rules).toEqual([
      {
        action: ['read'],
        subject: 'Script',
        conditions: { campaignIds: { $in: '${scope.campaignIds}' } },
      },
    ]);
    expect(dto.matrix).toEqual({ script: ['read'] });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: 'authz.role.created' }),
    );
    expect(outbox.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ type: 'verbis.authz.role.created.v1' }),
    );
  });

  it('refuses privilege escalation', async () => {
    const { service, tx, inCtx } = setup('campaign_manager');
    await expect(
      inCtx(() =>
        service.create({
          name: 'evil',
          matrix: { secret: { actions: ['read'], scope: 'all', revealPii: false } },
        }),
      ),
    ).rejects.toMatchObject({
      code: 'VERBIS_AUTHZ_PRIVILEGE_ESCALATION',
    } satisfies Partial<DomainError>);
    expect(tx.role.create).not.toHaveBeenCalled();
  });

  it('refuses reserved and duplicate names', async () => {
    await expect(
      setup('tenant_admin').inCtx(() =>
        setup('tenant_admin').service.create({ name: 'agent', matrix: {} }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    const dup = setup('tenant_admin', { id: 'x' });
    await expect(
      dup.inCtx(() => dup.service.create({ name: 'qa', matrix: {} })),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('updates a custom role with optimistic locking and audit', async () => {
    const existing = {
      id: ROLE_ID,
      name: 'qa',
      description: null,
      isSystem: false,
      permissions: [],
      rules: [],
      version: 1,
    };
    const { service, audit, inCtx, tx } = setup('tenant_admin', existing);
    const dto = await inCtx(() =>
      service.update(ROLE_ID, 1, {
        matrix: { report: { actions: ['read'], scope: 'all', revealPii: false } },
      }),
    );
    expect(dto.version).toBe(2);
    expect(tx.role.updateMany).toHaveBeenCalledOnce();
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: 'authz.role.updated' }),
    );
    await expect(inCtx(() => service.update(ROLE_ID, 7, { matrix: {} }))).rejects.toBeInstanceOf(
      VersionMismatchError,
    );
  });

  it('never changes system roles and 404s unknown ones', async () => {
    const sys = setup('tenant_admin', { id: ROLE_ID, name: 'agent', isSystem: true, version: 1 });
    await expect(
      sys.inCtx(() => sys.service.update(ROLE_ID, 1, { matrix: {} })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const none = setup('tenant_admin', null);
    await expect(
      none.inCtx(() => none.service.update(ROLE_ID, 1, { matrix: {} })),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('sets the ABAC scope of an assignment with audit', async () => {
    const existing = {
      id: ROLE_ID,
      name: 'script_designer',
      description: null,
      isSystem: true,
      permissions: [],
      rules: [],
      version: 1,
    };
    const { service, audit, tx, inCtx } = setup('tenant_admin', existing);
    const result = await inCtx(() =>
      service.setScope('user-1', { role: 'script_designer', scope: { campaignIds: ['c-1'] } }),
    );
    expect(result.scope).toEqual({ campaignIds: ['c-1'] });
    expect(tx.userRole.update).toHaveBeenCalledOnce();
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: 'authz.roleAssignment.scopeChanged' }),
    );
  });

  it('vocabulary lists resources, scopes and system roles', () => {
    const vocabulary = setup('tenant_admin').service.vocabulary();
    expect(vocabulary.resources).toContain('script');
    expect(vocabulary.scopes['session']).toEqual(['all', 'campaign', 'team', 'site', 'own']);
    expect(vocabulary.systemRoles).toHaveLength(11);
  });

  it('toRoleDto projects system roles from code', () => {
    const dto = toRoleDto({
      id: ROLE_ID,
      name: 'security_auditor',
      description: null,
      isSystem: true,
      permissions: [],
      rules: [],
      version: 1,
    });
    expect(dto.matrix).toEqual({ audit: ['export', 'read'] });
  });
});

it('lists projected roles and refuses a concurrent version change without emitting mutation events', async () => {
  const f = setup('tenant_admin', {
    id: ROLE_ID,
    name: 'qa',
    description: null,
    isSystem: false,
    rules: [],
    permissions: [],
    version: 1,
  });
  expect(await f.inCtx(() => f.service.list())).toHaveLength(1);
  f.tx.role.updateMany.mockResolvedValueOnce({ count: 0 });
  await expect(f.inCtx(() => f.service.update(ROLE_ID, 1, { matrix: {} }))).rejects.toBeInstanceOf(
    VersionMismatchError,
  );
  expect(f.audit.record).not.toHaveBeenCalled();
  expect(f.outbox.record).not.toHaveBeenCalled();
  f.tx.userRole.findFirst.mockResolvedValueOnce(null);
  await expect(
    f.inCtx(() => f.service.setScope('unknown', { role: 'agent', scope: {} })),
  ).rejects.toBeInstanceOf(NotFoundError);
  expect(f.tx.userRole.update).not.toHaveBeenCalled();
});
