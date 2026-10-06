import { expect, it, vi } from 'vitest';

import { ScriptDocumentSchema, VariableSchema, NodeSchema } from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';

import { requestContext } from '../../common/context/request-context.js';
import { Keyring } from '../identity/crypto/keyring.js';

import {
  emptySnapshot,
  OutcomeInputSchema,
  SecureFieldSchema,
  RecordingSchema,
} from './domain/runtime.js';
import { RuntimeCipher } from './runtime-cipher.js';
import { RuntimeEngineService, type EngineSession, tokenHash } from './runtime-engine.service.js';
import { RuntimePorts } from './runtime-ports.js';

import type { RuntimeStateStore } from './runtime-state.store.js';
import type { TenantDb } from '../../infra/database/tenant-db.js';
import type { AuditService } from '../audit/audit.service.js';
import type { SessionEventWriter } from '../audit/session-events/session-event.writer.js';
import type { AuthzService } from '../authz/authz.service.js';

const tenant = '01990000-0000-7000-8000-000000000001',
  id = '01990000-0000-7000-8000-000000000002',
  tab = '01990000-0000-7000-8000-000000000003';
function fixture() {
  const document = ScriptDocumentSchema.parse(minimalScript());
  document.variables.push(
    VariableSchema.parse({
      key: 'publicValue',
      type: 'string',
      scope: 'session',
      classification: 'public',
      persist: true,
      default: 'synthetic',
    }),
    VariableSchema.parse({
      key: 'privateValue',
      type: 'string',
      scope: 'session',
      classification: 'pii',
      pii: true,
      persist: false,
      default: '',
    }),
    VariableSchema.parse({
      key: 'secureValue',
      type: 'string',
      scope: 'session',
      classification: 'pci',
      persist: false,
      default: '',
    }),
  );
  const row = {
    id,
    tenantId: tenant,
    userId: id,
    teamId: null,
    kind: 'interaction',
    state: 'active',
    sequence: 0,
    version: 1,
    variables: {},
    scriptVersion: { documentEncoding: 'json', document, documentCompressed: null },
    interaction: null,
    writerHash: null,
    writerTabId: null,
    writerBffId: null,
    writerUntil: null,
    expiresAt: null,
  } as unknown as EngineSession;
  const snapshot = emptySnapshot();
  snapshot.variables['privateValue'] = 'synthetic-private';
  const store = {
      read: vi.fn().mockImplementation(() => Promise.resolve(structuredClone(snapshot))),
      seal: vi.fn().mockReturnValue({ sealed: 'synthetic' }),
      write: vi.fn().mockResolvedValue(undefined),
    },
    events = {
      append: vi.fn().mockResolvedValue([{ seq: 1 }]),
      seal: vi.fn().mockResolvedValue({ hash: 'synthetic' }),
    };
  const tx = {
      tenant: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          settings: {
            runtime: { transferableVariables: ['publicValue', 'privateValue', 'secureValue'] },
          },
        }),
      },
      $queryRaw: vi.fn().mockResolvedValue([]),
      session: {
        findFirst: vi.fn().mockResolvedValue(row),
        update: vi.fn().mockResolvedValue(row),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      campaign: {
        findFirst: vi.fn().mockResolvedValue({
          outcomeSet: [
            {
              code: 'DONE',
              label: 'Synthetic',
              category: 'success',
              requiresNote: true,
              requiredFields: ['publicValue'],
              subCodes: ['DETAIL'],
            },
          ],
        }),
      },
      outcome: { create: vi.fn().mockResolvedValue({ id: tab }) },
    },
    audit = { record: vi.fn().mockResolvedValue(undefined) },
    outbox = { record: vi.fn().mockResolvedValue(undefined) },
    authz = { authorize: vi.fn() };
  const keys = new RuntimeCipher(
    new Keyring(`synthetic:${Buffer.alloc(32, 9).toString('base64')}`),
  );
  const ports = new RuntimePorts();
  const service = new RuntimeEngineService(
    { tenantId: () => tenant, current: () => tx } as unknown as TenantDb,
    authz as unknown as AuthzService,
    events as unknown as SessionEventWriter,
    audit as unknown as AuditService,
    outbox,
    store as unknown as RuntimeStateStore,
    ports,
    keys,
  );
  const run = <T>(fn: () => T, actor = id, browser = true) =>
    requestContext.run(
      {
        requestId: 'synthetic',
        correlationId: 'synthetic',
        ip: '',
        userAgent: 'test',
        principal: {
          type: 'user',
          id: actor,
          tenantId: tenant,
          scopes: [],
          ...(browser ? { sessionId: 'synthetic-browser' } : {}),
        },
      },
      fn,
    );
  const claim = { tabId: tab, writeToken: 'a'.repeat(43), expectedSequence: 0 };
  const lease = () => {
    row.writerHash = tokenHash(claim.writeToken);
    row.writerTabId = tab;
    row.writerBffId = 'synthetic-browser';
    row.writerUntil = new Date(Date.now() + 60000);
  };
  return {
    service,
    row,
    snapshot,
    document,
    store,
    events,
    tx,
    audit,
    outbox,
    authz,
    keys,
    ports,
    run,
    claim,
    lease,
  };
}
function campaignInteraction(f: ReturnType<typeof fixture>) {
  f.row.interaction = {
    campaignId: tab,
    channelType: 'voice',
    connectorId: tab,
    externalId: 'synthetic-external',
  } as EngineSession['interaction'];
}

it.each([true, false])(
  'seals outcome note/fields and ends the session with callback %s',
  async (callback) => {
    const f = fixture();
    f.lease();
    f.row.state = 'wrapup';
    campaignInteraction(f);
    const input = OutcomeInputSchema.parse({
      ...f.claim,
      code: 'DONE',
      subCodes: ['DETAIL'],
      note: 'Synthetic confidential note',
      fields: { publicValue: 'visible', privateValue: 'synthetic-private' },
      ...(callback ? { callbackAt: '2026-10-05T00:00:00Z' } : {}),
    });
    const result = await f.run(() => f.service.outcome(id, input));
    expect(result).toMatchObject({ state: 'completed', readOnly: true, sequence: 1 });
    const created = f.tx.outcome.create.mock.calls[0]![0] as {
      data: { sealedData: string; callbackAt: Date | null };
    };
    expect(created.data.callbackAt).toEqual(callback ? new Date('2026-10-05T00:00:00Z') : null);
    expect(f.keys.openString(created.data.sealedData, `runtime:outcome:${tenant}:${id}`)).toBe(
      JSON.stringify({ note: input.note, fields: input.fields }),
    );
    expect(JSON.stringify(f.events.append.mock.calls)).not.toContain('Synthetic confidential note');
    expect(JSON.stringify(f.outbox.record.mock.calls)).not.toContain('synthetic-private');
    expect(f.events.seal).toHaveBeenCalledTimes(1);
  },
);

it.each([
  'state',
  'campaign',
  'missingCampaign',
  'code',
  'subCode',
  'note',
  'field',
  'variable',
] as const)('refuses unsafe outcome %s before creating its record', async (reason) => {
  const f = fixture();
  f.lease();
  f.row.state = 'wrapup';
  campaignInteraction(f);
  if (reason === 'state') f.row.state = 'active';
  if (reason === 'campaign') f.row.interaction = null;
  if (reason === 'missingCampaign') f.tx.campaign.findFirst.mockResolvedValue(null);
  const input = OutcomeInputSchema.parse({
    ...f.claim,
    code: reason === 'code' ? 'UNKNOWN' : 'DONE',
    subCodes: reason === 'subCode' ? ['UNKNOWN'] : [],
    note: reason === 'note' ? ' ' : 'Synthetic',
    fields:
      reason === 'field'
        ? {}
        : reason === 'variable'
          ? { publicValue: 3 }
          : { publicValue: 'visible' },
  });
  await expect(f.run(() => f.service.outcome(id, input))).rejects.toThrow();
  expect(f.tx.outcome.create).not.toHaveBeenCalled();
  expect(f.events.append).not.toHaveBeenCalled();
});

it('accepts only a verified secure receipt and keeps secure content out of event payloads', async () => {
  const f = fixture();
  f.lease();
  const verify = vi.fn().mockResolvedValue({ token: 'tok_synthetic_verified_receipt' });
  f.ports.registerTokenVerifier({ verify });
  const input = SecureFieldSchema.parse({
    ...f.claim,
    variable: 'secureValue',
    receipt: 'tok_synthetic_provider_receipt',
  });
  await f.run(() => f.service.secureField(id, input));
  expect(verify).toHaveBeenCalledWith({
    tenantId: tenant,
    sessionId: id,
    variable: 'secureValue',
    receipt: input.receipt,
  });
  expect(JSON.stringify(f.events.append.mock.calls)).not.toContain(input.receipt);
  expect(JSON.stringify(f.events.append.mock.calls)).not.toContain('tok_synthetic');
  expect(f.events.append.mock.calls[0]![1]).toEqual([
    { sessionId: id, type: 'field.secured', payload: { variable: 'secureValue', tokenized: true } },
  ]);
});

it.each(['inactive', 'public', 'unknown', 'global', 'provider'] as const)(
  'refuses unsafe secure-field capture: %s',
  async (reason) => {
    const f = fixture();
    f.lease();
    if (reason === 'inactive') f.row.state = 'paused';
    if (reason === 'global')
      f.document.variables.find((v) => v.key === 'secureValue')!.scope = 'global';
    const input = SecureFieldSchema.parse({
      ...f.claim,
      variable:
        reason === 'public' ? 'publicValue' : reason === 'unknown' ? 'missing' : 'secureValue',
      receipt: 'tok_synthetic_provider_receipt',
    });
    await expect(f.run(() => f.service.secureField(id, input))).rejects.toThrow();
    expect(f.events.append).not.toHaveBeenCalled();
  },
);

it.each([true, false])(
  'enqueues recording control %s without calling the connector inside the transaction',
  async (paused) => {
    const f = fixture();
    f.lease();
    campaignInteraction(f);
    const pauseRecording = vi.fn(),
      writeOutcome = vi.fn();
    f.ports.registerConnector(tab, { pauseRecording, writeOutcome });
    await f.run(() => f.service.recording(id, RecordingSchema.parse({ ...f.claim, paused })));
    expect(f.outbox.record.mock.calls[0]![1]).toMatchObject({
      type: 'verbis.runtime.recording.requested.v1',
      payload: { paused },
    });
    expect(pauseRecording).not.toHaveBeenCalled();
  },
);

it.each(['state', 'channel', 'connector', 'unconfigured'] as const)(
  'rejects unavailable recording control: %s',
  async (reason) => {
    const f = fixture();
    f.lease();
    campaignInteraction(f);
    if (reason === 'state') f.row.state = 'paused';
    if (reason === 'channel') f.row.interaction!.channelType = 'chat';
    if (reason === 'connector') f.row.interaction!.connectorId = null;
    await expect(
      f.run(() => f.service.recording(id, RecordingSchema.parse({ ...f.claim, paused: true }))),
    ).rejects.toThrow();
    expect(f.outbox.record).not.toHaveBeenCalled();
  },
);

it.each(['field.observed', 'text.acknowledged'] as const)(
  'records approved node activity %s as metadata only',
  async (type) => {
    const f = fixture();
    const node = NodeSchema.parse({
      id: 'synthetic-node',
      type: 'scriptText',
      props: { mustRead: true },
      bindings: [{ variable: 'publicValue' }],
    });
    f.document.pages[0]!.layout.children!.push(node);
    f.snapshot.currentPage = 'home';
    await f.run(() =>
      f.service.recordActivity(id, { type, name: node.id, status: 'success', durationMs: 100 }),
    );
    expect(f.events.append.mock.calls[0]![1]).toEqual([
      { sessionId: id, type, payload: { name: node.id, status: 'success', durationMs: 100 } },
    ]);
    expect(f.outbox.record.mock.calls[0]![1]).toMatchObject({
      payload: { analytics: { nodeId: node.id, durationMs: 100, error: false } },
    });
  },
);

it.each(['terminal', 'datasource', 'node', 'payload'] as const)(
  'refuses untrusted runtime activity %s',
  async (reason) => {
    const f = fixture();
    if (reason === 'terminal') f.row.state = 'completed';
    const input = {
      type: reason === 'datasource' ? 'datasource.called' : 'text.acknowledged',
      name: 'unapproved',
      status: 'success',
      durationMs: 1,
      ...(reason === 'payload' ? { rawBody: 'synthetic-confidential' } : {}),
    };
    await expect(f.run(() => f.service.recordActivity(id, input))).rejects.toThrow();
    expect(f.events.append).not.toHaveBeenCalled();
  },
);

it('seeds only non-PCI defaults and masks private values from supervisor views', async () => {
  const f = fixture();
  expect((await f.service.snapshot(f.row)).variables).toEqual({
    publicValue: 'synthetic',
    privateValue: 'synthetic-private',
  });
  const own = await f.run(() => f.service.view(id));
  expect(own.snapshot.variables['privateValue']).toBe('synthetic-private');
  const observed = await f.run(() => f.service.view(id, true));
  expect(observed.snapshot.variables['privateValue']).toBe('[REDACTED]');
  expect(f.audit.record).not.toHaveBeenCalled();
  await f.run(() => f.service.observation(id, 'started'));
  await f.run(() => f.service.view(id, true));
  expect(f.audit.record).toHaveBeenCalledTimes(1);
  await f.run(() => f.service.observation(id, 'stopped'));
  expect(f.audit.record).toHaveBeenCalledTimes(2);
  f.row.sequence = 2;
  f.snapshot.variables = {};
  expect((await f.service.snapshot(f.row)).variables).toEqual({});
});
it.each(['available', 'sameLease', 'busy', 'expired', 'terminal', 'handoff'] as const)(
  'fences writer attachment for %s sessions',
  async (condition) => {
    const f = fixture();
    if (condition !== 'available') f.lease();
    if (condition === 'busy') f.row.writerTabId = tenant;
    if (condition === 'expired') f.row.writerUntil = new Date(0);
    if (condition === 'terminal') f.row.state = 'completed';
    if (condition === 'handoff')
      f.row.interaction = {
        status: 'transferred',
        agentId: tenant,
      } as EngineSession['interaction'];
    const result = await f.run(() =>
      f.service.attach(id, {
        tabId: tab,
        ...(condition === 'sameLease' ? { writeToken: f.claim.writeToken } : {}),
      }),
    );
    const writable = ['available', 'sameLease', 'expired'].includes(condition);
    expect(result.readOnly).toBe(!writable);
    expect(f.tx.session.update).toHaveBeenCalledTimes(writable ? 1 : 0);
    if (condition === 'sameLease') expect(result.writeToken).toBe(f.claim.writeToken);
    if (writable) expect(result.writeToken).toHaveLength(43);
  },
);
it('rejects missing sessions, other owners, absent browser authentication and stale write claims', async () => {
  const f = fixture();
  f.tx.session.findFirst.mockResolvedValueOnce(null);
  await expect(f.service.row(id)).rejects.toThrow();
  await expect(f.run(() => f.service.attach(id, { tabId: tab }), tenant)).rejects.toThrow();
  await expect(f.run(() => f.service.attach(id, { tabId: tab }), id, false)).rejects.toThrow(
    'browser session',
  );
  f.lease();
  expect(() => {
    f.run(() => {
      f.service.claim(f.row, { ...f.claim, expectedSequence: 9 });
    });
  }).toThrow();
  expect(() => {
    f.run(() => {
      f.service.claim(f.row, { ...f.claim, writeToken: 'invalid' });
    });
  }).toThrow();
});
it('opens actual tenant-bound interaction envelopes and combines attached data without disclosing malformed storage', () => {
  const f = fixture();
  expect(f.service.interaction(f.row)).toEqual({});
  f.row.interaction = {
    id,
    attributes: {},
    queue: 'synthetic',
    channelType: 'voice',
    status: 'active',
  } as EngineSession['interaction'];
  expect(f.service.interaction(f.row)).toEqual({});
  f.row.interaction!.attributes = {
    sealed: f.keys.seal(
      JSON.stringify({ attachedData: { customerId: 'synthetic' }, ani: 'synthetic-number' }),
      `runtime:interaction:${tenant}:${id}`,
    ),
  };
  expect(f.service.interaction(f.row)).toMatchObject({
    customerId: 'synthetic',
    ani: 'synthetic-number',
    queue: 'synthetic',
    channel: 'voice',
    status: 'active',
  });
});
it.each(['field', 'page', 'timer'] as const)(
  'executes %s commands through the event watermark and optimistic write',
  async (type) => {
    const f = fixture();
    f.lease();
    const command =
      type === 'field'
        ? { type: 'field' as const, variable: 'publicValue', value: 'changed' }
        : type === 'page'
          ? { type: 'page' as const, pageId: 'home' }
          : { type: 'timer' as const, timerId: 'synthetic', durationMs: 1000 };
    await f.run(() => f.service.command(id, { ...f.claim, command }));
    expect(f.events.append).toHaveBeenCalledTimes(1);
    expect(f.tx.session.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id, tenantId: tenant, sequence: 0 } }),
    );
    expect(f.outbox.record).toHaveBeenCalledTimes(1);
  },
);
it('rejects invalid page history, timer overflow and conflicting writes without acknowledging them', async () => {
  const f = fixture();
  f.lease();
  await expect(
    f.run(() =>
      f.service.command(id, {
        ...f.claim,
        command: { type: 'page', pageId: 'home', history: ['missing'] },
      }),
    ),
  ).rejects.toThrow();
  f.snapshot.timers = Object.fromEntries(
    Array.from({ length: 100 }, (_, i) => [String(i), Date.now() + 60000]),
  );
  await expect(
    f.run(() =>
      f.service.command(id, {
        ...f.claim,
        command: { type: 'timer', timerId: 'new', durationMs: 1000 },
      }),
    ),
  ).rejects.toThrow();
  f.events.append.mockResolvedValueOnce([{ seq: 2 }]);
  await expect(
    f.run(() =>
      f.service.command(id, {
        ...f.claim,
        command: { type: 'field', variable: 'publicValue', value: 'changed' },
      }),
    ),
  ).rejects.toThrow('watermark');
  f.tx.session.updateMany.mockResolvedValueOnce({ count: 0 });
  await expect(
    f.run(() =>
      f.service.command(id, {
        ...f.claim,
        command: { type: 'field', variable: 'publicValue', value: 'changed' },
      }),
    ),
  ).rejects.toThrow('Concurrent');
  expect(f.outbox.record).not.toHaveBeenCalled();
});

it.each(['active', 'paused', 'launching', 'wrapup'] as const)(
  'expires %s sessions with terminal cleanup and a sealed event chain',
  async (state) => {
    const f = fixture();
    f.row.state = state;
    f.row.expiresAt = new Date(0);
    f.snapshot.timers = { synthetic: Date.now() + 1000 };
    f.snapshot.variables['secureValue'] = 'tok_abcdefghijklmnop';
    await f.run(() =>
      f.service.expire(f.tx as unknown as Parameters<typeof f.service.expire>[0], id),
    );
    const update = f.tx.session.updateMany.mock.calls[0]![0] as {
      data: { state: string; writerHash: null; expiresAt: null };
    };
    expect(update.data).toMatchObject({
      state: state === 'active' || state === 'paused' ? 'abandoned' : 'expired',
      writerHash: null,
      expiresAt: null,
    });
    expect(f.events.seal).toHaveBeenCalledWith(f.tx, id);
    const cached = f.store.write.mock.calls[0]?.[3] as { variables: Record<string, unknown> };
    expect(cached.variables['secureValue']).toBeUndefined();
  },
);
it('ignores unexpired and terminal sessions and rejects oversized state before writing events', async () => {
  const f = fixture();
  await f.service.expire(f.tx as unknown as Parameters<typeof f.service.expire>[0], id);
  f.row.expiresAt = new Date(Date.now() + 60000);
  await f.service.expire(f.tx as unknown as Parameters<typeof f.service.expire>[0], id);
  f.row.state = 'completed';
  f.row.expiresAt = new Date(0);
  await f.service.expire(f.tx as unknown as Parameters<typeof f.service.expire>[0], id);
  expect(f.events.append).not.toHaveBeenCalled();
  f.snapshot.variables['publicValue'] = 'x'.repeat(512001);
  await expect(
    f.run(() => f.service.save(f.row, f.snapshot, 'active', 'field.changed', {})),
  ).rejects.toThrow();
  expect(f.events.append).not.toHaveBeenCalled();
});
it('initializes only a new launching session and fences repeated initialization', async () => {
  const f = fixture();
  f.row.state = 'launching';
  await f.run(() => f.service.initialize(id));
  expect(f.events.append).toHaveBeenCalledWith(f.tx, [
    { sessionId: id, type: 'session.created', payload: {} },
  ]);
  f.row.sequence = 1;
  await expect(f.service.initialize(id)).rejects.toThrow('already initialized');
});

function transferFixture() {
  const f = fixture();
  f.lease();
  const target = {
    ...f.row,
    id: tab,
    userId: tenant,
    writerHash: null,
    writerTabId: null,
    writerBffId: null,
    writerUntil: null,
    interactionId: tab,
    scriptVersionId: id,
  };
  f.row.interactionId = tab;
  f.row.scriptVersionId = id;
  f.row.interaction = {
    id: tab,
    status: 'transferred',
    agentId: tenant,
  } as EngineSession['interaction'];
  f.tx.session.findFirst.mockImplementation((input: { where: { id: string } }) =>
    Promise.resolve(input.where.id === tab ? target : f.row),
  );
  const input = { ...f.claim, targetSessionId: tab, targetSequence: 0, variables: ['publicValue'] };
  return { ...f, target, input };
}
it.each(['active', 'paused'] as const)(
  'transfers only explicitly permitted persisted context from a %s source',
  async (state) => {
    const f = transferFixture();
    f.row.state = state;
    await f.run(() => f.service.transfer(id, f.input));
    const writes = f.tx.session.updateMany.mock.calls as unknown as [{ data: { state: string } }][];
    expect(writes.map((call) => call[0].data.state)).toEqual(['active', 'paused']);
    expect(
      f.events.append.mock.calls.map(
        (call) => (call as unknown as [unknown, { type: string }[]])[1][0]?.type,
      ),
    ).toEqual(['context.received', 'context.transferred']);
    expect(JSON.stringify(f.events.append.mock.calls)).not.toContain('synthetic-private');
    expect(
      f.tx.$queryRaw.mock.calls
        .slice(0, 2)
        .map((call) => (call as unknown as [unknown, string])[1]),
    ).toEqual([id, tab].sort());
  },
);
it.each([
  'same session',
  'different interaction',
  'different script',
  'not transferred',
  'wrong target agent',
  'same user',
  'terminal target',
  'target sequence',
  'unknown variable',
  'not permitted',
  'PII',
  'PCI',
  'nonpersisted',
] as const)('rejects unsafe handoff: %s', async (reason) => {
  const f = transferFixture();
  if (reason === 'same session') f.input.targetSessionId = id;
  if (reason === 'different interaction') f.target.interactionId = tenant;
  if (reason === 'different script') f.target.scriptVersionId = tenant;
  if (reason === 'not transferred') f.row.interaction!.status = 'active';
  if (reason === 'wrong target agent') f.row.interaction!.agentId = id;
  if (reason === 'same user') f.target.userId = id;
  if (reason === 'terminal target') f.target.state = 'completed';
  if (reason === 'target sequence') f.input.targetSequence = 1;
  if (reason === 'unknown variable') f.input.variables = ['unknown'];
  if (reason === 'not permitted')
    f.tx.tenant.findUniqueOrThrow.mockResolvedValue({
      settings: { runtime: { transferableVariables: [] } },
    });
  if (reason === 'PII') f.input.variables = ['privateValue'];
  if (reason === 'PCI') f.input.variables = ['secureValue'];
  if (reason === 'nonpersisted')
    f.document.variables.find((variable) => variable.key === 'publicValue')!.persist = false;
  await expect(f.run(() => f.service.transfer(id, f.input))).rejects.toThrow();
  expect(f.events.append).not.toHaveBeenCalled();
  expect(f.tx.session.updateMany).not.toHaveBeenCalled();
});

it.each([false, true])(
  'makes a failed cache write visible and fails closed for payment references=%s',
  async (payment) => {
    const f = fixture();
    f.lease();
    if (payment) f.snapshot.variables['secureValue'] = 'tok_abcdefghijklmnop';
    f.store.write.mockRejectedValue(new Error('private cache detail'));
    const command = f.run(() =>
      f.service.command(id, {
        ...f.claim,
        command: { type: 'field', variable: 'publicValue', value: 'changed' },
      }),
    );
    if (payment) await expect(command).rejects.toThrow('Payment state could not be stored');
    else await expect(command).resolves.toMatchObject({ sequence: 1 });
  },
);
