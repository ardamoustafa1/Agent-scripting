import { describe, expect, it, vi } from 'vitest';

import { ScriptDocumentSchema, DataSourceRefSchema } from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';

import { requestContext } from '../../common/context/request-context.js';
import { DomainError } from '../../common/errors/domain-errors.js';

import { AgentDesktopController } from './agent-desktop.controller.js';
import { RuntimeDataService } from './runtime-data.service.js';

import type { RuntimeEngineService } from './runtime-engine.service.js';
import type { SecureCaptureService } from './secure-capture.service.js';
import type { TenantDb } from '../../infra/database/tenant-db.js';
import type { AuditService } from '../audit/audit.service.js';
import type { IntegrationEngineService } from '../integrations/integration-engine.service.js';

const id = '01928f3a-0000-7000-8000-000000000001',
  owner = '01928f3a-0000-7000-8000-000000000002',
  tenant = '01928f3a-0000-7000-8000-000000000003';
function fixture(state = 'active') {
  const row = {
    userId: owner,
    tenantId: tenant,
    state,
    checksum: 'synthetic',
    startedAt: new Date('2026-10-03T09:00:00Z'),
    interaction: {
      campaignId: null,
      channelType: 'voice',
      status: 'connected',
      queue: null,
      platform: 'generic',
    },
  };
  const document = ScriptDocumentSchema.parse(minimalScript());
  const runtime = {
    row: vi.fn().mockResolvedValue(row),
    snapshot: vi.fn().mockResolvedValue({ variables: { name: 'Operator value' } }),
    authorize: vi.fn(),
    claim: vi.fn(),
    interaction: vi
      .fn<RuntimeEngineService['interaction']>()
      .mockReturnValue({ customerName: 'Synthetic customer' }),
    document: vi.fn().mockReturnValue(document),
    view: vi.fn().mockResolvedValue({ id }),
    viewFromRow: vi.fn().mockResolvedValue({ id }),
    recordActivity: vi.fn().mockResolvedValue(undefined),
  };
  const tx = {
    campaign: { findFirst: vi.fn().mockResolvedValue(null) },
    user: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ displayName: 'Ayşe Yılmaz', email: 'ayse@example.test' }),
    },
    auditEvent: { findFirst: vi.fn().mockResolvedValue(null) },
    dataSource: { findFirst: vi.fn().mockResolvedValue({ id: 'source-id' }) },
  };
  const db = {
    current: () => tx,
    tenantId: () => tenant,
    run: vi.fn(async (_tenant: string, work: (value: typeof tx) => Promise<unknown>) => work(tx)),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const integration = {
    failure: vi.fn(
      (error: string | null) =>
        new DomainError('VERBIS_INTEGRATION_FAILED', undefined, [
          { path: '/dataSource', message: error ?? 'INTEGRATION_FAILED' },
        ]),
    ),
    prepareAuthorized: vi.fn().mockResolvedValue('prepared'),
    executePrepared: vi.fn().mockResolvedValue({ value: { ok: true }, durationMs: 4 }),
  };
  const controller = new AgentDesktopController(
    db as unknown as TenantDb,
    runtime as unknown as RuntimeEngineService,
    new RuntimeDataService(
      db as unknown as TenantDb,
      runtime as unknown as RuntimeEngineService,
      integration as unknown as IntegrationEngineService,
    ),
    audit as unknown as AuditService,
    { publicProfile: () => undefined } as unknown as SecureCaptureService,
  );
  return { controller, runtime, tx, audit, integration, document, db };
}
function asUser<T>(user: string, work: () => T) {
  return requestContext.run(
    {
      requestId: id,
      correlationId: id,
      ip: '',
      userAgent: 'synthetic',
      principal: {
        type: 'user',
        id: user,
        tenantId: tenant,
        scopes: [],
        sessionId: 'synthetic-bff',
        authMethod: 'sso',
      },
    },
    work,
  );
}
describe('owner-only agent desktop BFF boundary', () => {
  it('rejects another owner before returning context or auditing a successful read', async () => {
    const f = fixture();
    await expect(asUser('another-user', () => f.controller.desktop(id))).rejects.toThrow();
    expect(f.runtime.interaction).not.toHaveBeenCalled();
    expect(f.audit.record).not.toHaveBeenCalled();
  });
  it('audits context access and never marks queued write-back as successful', async () => {
    const f = fixture('completed');
    const result = await asUser(owner, () => f.controller.desktop(id));
    expect(result.writeback).toBe('queued');
    expect(f.runtime.row).toHaveBeenCalledTimes(1);
    expect(f.runtime.viewFromRow).toHaveBeenCalledWith(await f.runtime.row.mock.results[0]?.value);
    expect(f.runtime.view).not.toHaveBeenCalled();
    expect(f.audit.record).toHaveBeenCalledWith(
      f.tx,
      expect.objectContaining({ action: 'runtime.desktop.read' }),
    );
    f.tx.auditEvent.findFirst.mockResolvedValue({ id: 'ack' });
    expect((await asUser(owner, () => f.controller.desktop(id))).writeback).toBe('success');
  });
  it('fences the writer before looking up or executing an integration', async () => {
    const f = fixture();
    f.runtime.claim.mockImplementation(() => {
      throw Error('fenced');
    });
    await expect(
      asUser(owner, () =>
        f.controller.call(id, {
          sourceId: 'missing',
          expectedSequence: 1,
          tabId: id,
          writeToken: 'a'.repeat(43),
          input: {},
        }),
      ),
    ).rejects.toThrow('fenced');
    expect(f.tx.dataSource.findFirst).not.toHaveBeenCalled();
    expect(f.integration.executePrepared).not.toHaveBeenCalled();
  });
  it('rejects a source absent from the immutable script pin', async () => {
    const f = fixture();
    await expect(
      asUser(owner, () =>
        f.controller.call(id, {
          sourceId: 'untrusted',
          expectedSequence: 1,
          tabId: id,
          writeToken: 'a'.repeat(43),
          input: {},
        }),
      ),
    ).rejects.toThrow();
    expect(f.integration.executePrepared).not.toHaveBeenCalled();
  });
});

it('resolves the exact pinned source version and records the successful session activity', async () => {
  const f = fixture();
  f.document.dataSources.push(
    DataSourceRefSchema.parse({ id: 'lookup', ref: 'tenant-datasource:customer', version: 3 }),
  );
  await asUser(owner, () =>
    f.controller.call(id, {
      sourceId: 'lookup',
      expectedSequence: 1,
      tabId: id,
      writeToken: 'a'.repeat(43),
      input: { key: 'synthetic' },
    }),
  );
  expect(f.tx.dataSource.findFirst).toHaveBeenCalledWith({
    where: { tenantId: tenant, key: 'customer', deletedAt: null },
    select: { id: true },
  });
  expect(f.integration.prepareAuthorized).toHaveBeenCalledWith('source-id', id, {
    input: { key: 'synthetic' },
    environment: 'prod',
  });
  expect(f.runtime.recordActivity).toHaveBeenCalledWith(
    id,
    expect.objectContaining({ type: 'datasource.called', name: 'lookup', status: 'success' }),
  );
});

it('audits safe client failure metadata only for the owner', async () => {
  const f = fixture();
  const input = { kind: 'script', correlationId: 'support-safe' };
  await expect(asUser(owner, () => f.controller.failure(id, input))).resolves.toEqual({
    recorded: true,
  });
  expect(f.audit.record).toHaveBeenCalledWith(
    f.tx,
    expect.objectContaining({
      action: 'runtime.desktop.failed',
      outcome: 'failure',
      metadata: input,
    }),
  );
  await expect(asUser(tenant, () => f.controller.failure(id, input))).rejects.toThrow();
});
it.each(['continue', 'manual'] as const)(
  'requires the pinned script %s recovery policy and the writer claim',
  async (mode) => {
    const f = fixture();
    f.document.variables.push({
      key: 'name',
      type: 'string',
      scope: 'session',
      pii: false,
      persist: false,
      classification: 'public',
    });
    const source = DataSourceRefSchema.parse({
      id: 'lookup',
      ref: 'tenant-datasource:lookup',
      version: 1,
      outputs: { answer: { path: '$.answer', variable: 'name' } },
      policy: { onFailure: mode },
    });
    f.document.dataSources.push(source);
    const input = {
      tabId: id,
      writeToken: 'a'.repeat(43),
      expectedSequence: 1,
      sourceId: 'lookup',
      mode,
    };
    await expect(asUser(owner, () => f.controller.recovery(id, input))).resolves.toEqual({ id });
    expect(f.runtime.claim).toHaveBeenCalled();
    source.policy.onFailure = 'block';
    await expect(asUser(owner, () => f.controller.recovery(id, input))).rejects.toThrow();
    source.policy.onFailure = mode;
    f.runtime.claim.mockImplementationOnce(() => {
      throw Error('writer refused');
    });
    await expect(asUser(owner, () => f.controller.recovery(id, input))).rejects.toThrow(
      'writer refused',
    );
    await expect(asUser(tenant, () => f.controller.recovery(id, input))).rejects.toThrow();
    if (mode === 'manual') {
      f.document.variables[0]!.classification = 'pci';
      await expect(asUser(owner, () => f.controller.recovery(id, input))).rejects.toThrow(
        'Manual fallback',
      );
    }
  },
);

it('uses normalized channel customer metadata when the platform has no flat customerName attribute', async () => {
  const f = fixture();
  f.runtime.row.mockResolvedValue({
    userId: owner,
    tenantId: tenant,
    state: 'active',
    checksum: 'test',
    startedAt: new Date(),
    interaction: {
      campaignId: null,
      channelType: 'chat',
      status: 'connected',
      queue: null,
      platform: 'generic',
    },
  });
  f.runtime.interaction.mockReturnValue({ 'channel.chat.customerName': 'Scoped customer' });
  const result = await asUser(owner, () => f.controller.desktop(id));
  expect(result.interaction.customerName).toBe('Scoped customer');
});

it('releases the preparation transaction before HTTP and fences the result in a second transaction', async () => {
  const f = fixture();
  f.document.dataSources.push(
    DataSourceRefSchema.parse({ id: 'lookup', ref: 'tenant-datasource:customer', version: 3 }),
  );
  f.integration.executePrepared.mockImplementation(() => {
    expect(requestContext.require().tx).toBeUndefined();
    return Promise.resolve({ value: { ok: true }, durationMs: 4 });
  });
  await asUser(owner, () =>
    f.controller.call(id, {
      sourceId: 'lookup',
      expectedSequence: 1,
      tabId: id,
      writeToken: 'a'.repeat(43),
      input: {},
    }),
  );
  expect(f.db.run).toHaveBeenCalledTimes(2);
  expect(f.runtime.claim).toHaveBeenCalledTimes(2);
});
it('records fallback as failed activity rather than successful upstream data', async () => {
  const f = fixture();
  f.document.dataSources.push(
    DataSourceRefSchema.parse({ id: 'lookup', ref: 'tenant-datasource:customer', version: 3 }),
  );
  f.integration.executePrepared.mockResolvedValue({
    value: { ok: true },
    durationMs: 4,
    error: 'TIMEOUT',
  });
  await asUser(owner, () =>
    f.controller.call(id, {
      sourceId: 'lookup',
      expectedSequence: 1,
      tabId: id,
      writeToken: 'a'.repeat(43),
      input: {},
    }),
  );
  expect(f.runtime.recordActivity).toHaveBeenCalledWith(
    id,
    expect.objectContaining({ status: 'failure' }),
  );
});

it('refuses a late result after writer sequence changes while upstream is in flight', async () => {
  const f = fixture();
  f.document.dataSources.push(
    DataSourceRefSchema.parse({ id: 'lookup', ref: 'tenant-datasource:customer', version: 3 }),
  );
  f.integration.executePrepared.mockImplementation(() => {
    f.runtime.claim.mockImplementation(() => {
      throw new Error('stale sequence');
    });
    return Promise.resolve({ value: { ok: true }, durationMs: 4 });
  });
  await expect(
    asUser(owner, () =>
      f.controller.call(id, {
        sourceId: 'lookup',
        expectedSequence: 1,
        tabId: id,
        writeToken: 'a'.repeat(43),
        input: {},
      }),
    ),
  ).rejects.toThrow('stale sequence');
  expect(f.runtime.recordActivity).not.toHaveBeenCalled();
});

it('commits failed datasource activity before returning a sanitized timeout problem', async () => {
  const f = fixture();
  f.document.dataSources.push(
    DataSourceRefSchema.parse({ id: 'lookup', ref: 'tenant-datasource:customer', version: 3 }),
  );
  f.integration.executePrepared.mockResolvedValue({
    value: undefined,
    durationMs: 4,
    error: 'TIMEOUT',
  });
  await expect(
    asUser(owner, () =>
      f.controller.call(id, {
        sourceId: 'lookup',
        expectedSequence: 1,
        tabId: id,
        writeToken: 'a'.repeat(43),
        input: {},
      }),
    ),
  ).rejects.toMatchObject({
    code: 'VERBIS_INTEGRATION_FAILED',
    errors: [{ path: '/dataSource', message: 'TIMEOUT' }],
  });
  expect(f.runtime.recordActivity).toHaveBeenCalledWith(
    id,
    expect.objectContaining({ status: 'failure' }),
  );
  expect(f.runtime.view).toHaveBeenCalled();
});
// M-Z6: the agent's own name was never sent, so `{agent}` rendered empty in live scripts.
it('provides the owning agent display and first name for script personalization', async () => {
  const f = fixture();
  const result = await asUser(owner, () => f.controller.desktop(id));
  expect(result.agent).toEqual({ id: owner, displayName: 'Ayşe Yılmaz', firstName: 'Ayşe' });
  expect(f.tx.user.findFirst).toHaveBeenCalledWith({
    where: { id: owner, tenantId: tenant, deletedAt: null },
    select: { displayName: true, email: true },
  });
});
it('does not present an e-mail fallback display name as the agent name', async () => {
  const f = fixture();
  f.tx.user.findFirst.mockResolvedValue({
    displayName: 'ayse@example.test',
    email: 'ayse@example.test',
  });
  const result = await asUser(owner, () => f.controller.desktop(id));
  expect(result.agent).toEqual({ id: owner, displayName: null, firstName: null });
});
