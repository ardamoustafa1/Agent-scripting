import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { ScriptDocumentSchema } from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';

import { requestContext, systemContext } from '../../common/context/request-context.js';

import { CreateTemplateSchema, TemplatesService } from './templates.service.js';

import type { ScriptsService } from './scripts.service.js';
import type { TenantDb } from '../../infra/database/tenant-db.js';
import type { AuditService } from '../audit/audit.service.js';

function fixture() {
  const document = ScriptDocumentSchema.parse(minimalScript());
  const tx = {
    template: {
      findMany: vi
        .fn()
        .mockResolvedValue([
          { id: randomUUID(), name: 'Synthetic saved', createdAt: new Date(), category: 'sales' },
        ]),
      findFirst: vi.fn().mockResolvedValue({ document }),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({}),
    },
    scriptVersion: {
      findFirst: vi.fn().mockResolvedValue({
        id: randomUUID(),
        document,
        documentEncoding: 'json',
        documentCompressed: null,
        checksum: 'synthetic-checksum',
      }),
    },
  };
  const scripts = {
    authorizeRead: vi.fn().mockResolvedValue(undefined),
    create: vi
      .fn<ScriptsService['create']>()
      .mockResolvedValue({ id: randomUUID() } as Awaited<ReturnType<ScriptsService['create']>>),
    createVersion: vi
      .fn<ScriptsService['createVersion']>()
      .mockResolvedValue({ id: randomUUID() } as Awaited<
        ReturnType<ScriptsService['createVersion']>
      >),
  };
  const record = vi.fn().mockResolvedValue(undefined),
    tenantId = randomUUID();
  const service = new TemplatesService(
    { current: () => tx, tenantId: () => tenantId } as unknown as TenantDb,
    { record } as unknown as AuditService,
    scripts as unknown as ScriptsService,
  );
  const run = <T>(work: () => T) =>
    requestContext.run(
      {
        ...systemContext(randomUUID(), 'synthetic'),
        principal: { type: 'user', id: randomUUID(), tenantId, scopes: [] },
      },
      work,
    );
  return { service, scripts, tx, record, document, run };
}
describe('template authoring and tenant boundaries', () => {
  it('validates every shipped template during instantiation and preserves independent copies', async () => {
    const f = fixture();
    const templates = await f.service.list({});
    const builtins = templates.filter((template) => template.builtIn);
    expect(builtins).toHaveLength(6);
    for (const template of builtins) {
      await f.run(() => f.service.instantiate(template.id, { name: 'Synthetic copy' }));
      const input = f.scripts.createVersion.mock.calls.at(-1)?.[1];
      expect(ScriptDocumentSchema.parse(input?.document).meta.name).toBe('Synthetic copy');
    }
    expect(f.tx.template.findFirst).not.toHaveBeenCalled();
    const again = await f.service.list({});
    expect(again.filter((template) => template.builtIn).map((template) => template.name)).toEqual(
      builtins.map((template) => template.name),
    );
  });
  it('combines category and case-insensitive search while retaining saved tenant templates', async () => {
    const f = fixture();
    const templates = await f.service.list({ category: 'service', q: 'INSURANCE' });
    expect(templates.filter((template) => template.builtIn)).toEqual([
      expect.objectContaining({ id: 'builtin-insurance-renewal' }),
    ]);
    expect(f.tx.template.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        category: 'service',
        name: { contains: 'INSURANCE', mode: 'insensitive' },
        deletedAt: null,
      },
    });
  });
  it.each([true, false])(
    'copies an authorized source version with optional description (%s)',
    async (description) => {
      const f = fixture();
      const input = CreateTemplateSchema.parse({
        name: 'Synthetic',
        category: 'sales',
        scriptId: randomUUID(),
        versionNumber: 1,
        ...(description ? { description: 'Synthetic description' } : {}),
      });
      expect(await f.run(() => f.service.create(input))).toMatchObject({
        name: 'Synthetic',
        checksum: 'synthetic-checksum',
      });
      expect(f.scripts.authorizeRead).toHaveBeenCalledWith(input.scriptId);
      expect(f.tx.template.create).toHaveBeenCalledOnce();
      expect(f.record).toHaveBeenCalledOnce();
    },
  );
  it.each(['missing source', 'duplicate name', 'denied source'] as const)(
    'refuses %s before creating a template',
    async (reason) => {
      const f = fixture();
      if (reason === 'missing source') f.tx.scriptVersion.findFirst.mockResolvedValue(null);
      if (reason === 'duplicate name') f.tx.template.count.mockResolvedValue(1);
      if (reason === 'denied source')
        f.scripts.authorizeRead.mockRejectedValue(new Error('Denied'));
      const input = CreateTemplateSchema.parse({
        name: 'Synthetic',
        category: 'sales',
        scriptId: randomUUID(),
        versionNumber: 1,
      });
      await expect(f.run(() => f.service.create(input))).rejects.toThrow();
      expect(f.tx.template.create).not.toHaveBeenCalled();
      expect(f.record).not.toHaveBeenCalled();
    },
  );
  it('instantiates saved tenant templates with provenance and refuses a missing template', async () => {
    const f = fixture();
    const id = randomUUID();
    await f.run(() =>
      f.service.instantiate(id, { name: 'Synthetic copy', description: 'Synthetic description' }),
    );
    expect(f.scripts.create.mock.calls[0]?.[0]).toMatchObject({
      description: 'Synthetic description',
    });
    expect(f.scripts.createVersion.mock.calls[0]?.[2]).toEqual({ source: { templateId: id } });
    expect(f.document.meta.name).toBe('Minimal');
    f.tx.template.findFirst.mockResolvedValue(null);
    await expect(
      f.run(() => f.service.instantiate(randomUUID(), { name: 'Missing' })),
    ).rejects.toThrow();
    expect(f.scripts.create).toHaveBeenCalledOnce();
  });
});
