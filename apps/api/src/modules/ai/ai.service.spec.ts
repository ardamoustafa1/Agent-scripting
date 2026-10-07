import { describe, expect, it, vi } from 'vitest';

import { NodeSchema, ScriptDocumentSchema } from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';
import { AiConfigSchema, AiRequestSchema } from '@verbis/shared-types';

import { requestContext } from '../../common/context/request-context.js';

import { AiService, cost } from './ai.service.js';
import { postJson } from './transport.js';

import type { ApiEnv } from '../../env.js';
import type { TenantDb } from '../../infra/database/tenant-db.js';
import type { OutboxWriter } from '../../infra/outbox/outbox.writer.js';
import type { AuditService } from '../audit/audit.service.js';
import type { AuthzService } from '../authz/authz.service.js';
import type { EnvelopeVault } from '../integrations/engine/vault.js';
import type { RuntimeEngineService } from '../runtime/runtime-engine.service.js';
import type { ScriptsService } from '../scripts/scripts.service.js';

vi.mock('./transport.js', () => ({ postJson: vi.fn() }));

it('rounds integer micro-USD cost upwards without floating currency persistence', () => {
  const config = AiConfigSchema.parse({
    inputMicroUsdPerMillion: 1_000_000,
    outputMicroUsdPerMillion: 2_000_000,
  });
  expect(cost(100, 50, config)).toBe(200);
});
it('disabled tenant does not decrypt secrets or invoke a provider', async () => {
  const complete = vi.fn(),
    decrypt = vi.fn(),
    tx = {
      tenant: { findFirstOrThrow: vi.fn().mockResolvedValue({ status: 'active', settings: {} }) },
    };
  const service = new AiService(
    {
      tenantId: () => '00000000-0000-7000-8000-000000000001',
      run: (_id: string, fn: (t: unknown) => unknown) => fn(tx),
    } as unknown as TenantDb,
    {} as AuditService,
    {} as AuthzService,
    {} as OutboxWriter,
    { AI_ENABLED: true } as ApiEnv,
    { decrypt } as unknown as EnvelopeVault,
    {} as RuntimeEngineService,
    {} as ScriptsService,
    { complete },
  );
  await requestContext.run(
    {
      requestId: 'fixture',
      correlationId: 'fixture',
      ip: '',
      userAgent: 'test',
      principal: {
        type: 'user',
        id: '00000000-0000-7000-8000-000000000002',
        tenantId: '00000000-0000-7000-8000-000000000001',
        scopes: [],
        authMethod: 'sso',
      },
    },
    async () => {
      await expect(
        service.generate(
          AiRequestSchema.parse({
            requestId: '00000000-0000-7000-8000-000000000003',
            task: 'improve',
            text: 'Synthetic',
          }),
        ),
      ).rejects.toMatchObject({ code: 'VERBIS_AI_DISABLED' });
    },
  );
  expect(complete).not.toHaveBeenCalled();
  expect(decrypt).not.toHaveBeenCalled();
});

function enabledService(quotaAllowed = true, agentEnabled = false) {
  const config = AiConfigSchema.parse({
    enabled: true,
    agentEnabled,
    endpointId: 'fixture',
    model: 'fixture-model',
    secretRef: '00000000-0000-7000-8000-000000000004',
    monthlyTokens: 1_000_000,
    monthlyMicroUsd: 1_000_000,
    inputMicroUsdPerMillion: 1_000_000,
    outputMicroUsdPerMillion: 1_000_000,
  });
  const complete = vi.fn().mockResolvedValue({
    text: '{"text":"Synthetic suggestion","legalChecklist":[]}',
    inputTokens: 8,
    outputTokens: 4,
  });
  const audit = { record: vi.fn().mockResolvedValue({}) };
  const document = ScriptDocumentSchema.parse(minimalScript());
  document.pages[0]!.layout.children!.push(
    NodeSchema.parse({ id: 'objection-approved', type: 'objectionHandler' }),
  );
  const row = {
    kind: 'interaction',
    state: 'active',
    interaction: {
      channelType: 'chat',
      campaignId: '00000000-0000-7000-8000-000000000005' as string | null,
    },
  };
  const runtime = {
    row: vi.fn().mockResolvedValue(row),
    authorize: vi.fn(),
    document: () => document,
    interaction: vi
      .fn()
      .mockReturnValue({ 'channel.chat.transcript': 'Synthetic customer transcript' }),
    snapshot: vi.fn().mockResolvedValue({ currentPage: 'home' }),
  };
  const scripts = { authorizeRead: vi.fn().mockResolvedValue(undefined) };
  const tx = {
    tenant: {
      findFirstOrThrow: vi.fn().mockResolvedValue({
        id: '00000000-0000-7000-8000-000000000001',
        version: 1,
        status: 'active',
        settings: { ai: config },
      }),
    },
    secret: {
      findFirst: vi.fn().mockResolvedValue({
        id: config.secretRef,
        keyVersion: 1,
        ciphertext: Buffer.from('fixture'),
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    campaign: { findFirst: vi.fn().mockResolvedValue({ outcomeSet: [{ code: 'APPROVED' }] }) },
    $queryRaw: vi.fn().mockResolvedValue([]),
    $executeRaw: vi.fn((strings: TemplateStringsArray) =>
      Promise.resolve(
        strings[0]?.includes('UPDATE ai_usage SET tokens=tokens+') && !quotaAllowed ? 0 : 1,
      ),
    ),
  };
  const db = {
    current: () => tx,
    tenantId: () => '00000000-0000-7000-8000-000000000001',
    run: (_id: string, fn: (t: unknown) => unknown) => fn(tx),
  } as unknown as TenantDb;
  const env = {
    AI_ENABLED: true,
    AI_ENDPOINTS_JSON: JSON.stringify([
      {
        id: 'fixture',
        provider: 'onprem',
        url: 'https://model.example.invalid/v1/chat/completions',
        residency: 'fixture',
        models: ['fixture-model'],
        addresses: ['10.1.2.3'],
      },
    ]),
    AI_REDACTOR_JSON: JSON.stringify({
      url: 'https://pii.example.invalid/redact',
      addresses: ['10.1.2.4'],
    }),
  } as ApiEnv;
  const service = new AiService(
    db,
    audit as unknown as AuditService,
    { authorize: vi.fn() } as unknown as AuthzService,
    { record: vi.fn().mockResolvedValue('fixture') },
    env,
    { decrypt: vi.fn().mockResolvedValue('synthetic-key') } as unknown as EnvelopeVault,
    runtime as unknown as RuntimeEngineService,
    scripts as unknown as ScriptsService,
    { complete },
  );
  return { service, complete, audit, tx, config, env, runtime, scripts, row, document };
}
const context = {
  requestId: 'fixture',
  correlationId: 'fixture',
  ip: '',
  userAgent: 'test',
  principal: {
    type: 'user' as const,
    id: '00000000-0000-7000-8000-000000000002',
    tenantId: '00000000-0000-7000-8000-000000000001',
    scopes: [],
    authMethod: 'sso' as const,
  },
};
const request = () =>
  AiRequestSchema.parse({
    requestId: '00000000-0000-7000-8000-000000000003',
    task: 'improve',
    text: 'customer@example.invalid',
  });
it('redacts before provider invocation and audits metadata without raw content', async () => {
  const fixture = enabledService();
  vi.mocked(postJson).mockResolvedValue({
    text: '{"text":"[REDACTED]"}',
    count: 1,
    complete: true,
  });
  const result = await requestContext.run(context, () => fixture.service.generate(request()));
  expect(result.requiresHumanApproval).toBe(true);
  expect(fixture.complete.mock.calls[0]?.[4]).not.toContain('customer@example.invalid');
  const audit = JSON.stringify(fixture.audit.record.mock.calls);
  expect(audit).not.toContain('customer@example.invalid');
  expect(audit).not.toContain('Synthetic suggestion');
  expect(audit).toContain('inputHash');
  expect(audit).toContain('inputTokens');
});
it('uncertain local recognition never falls back to sending regex-only content', async () => {
  const fixture = enabledService();
  vi.mocked(postJson).mockResolvedValue({ text: 'uncertain fixture', count: 0, complete: false });
  await requestContext.run(context, () =>
    expect(fixture.service.generate(request())).rejects.toMatchObject({
      code: 'VERBIS_AI_UNAVAILABLE',
    }),
  );
  expect(fixture.complete).not.toHaveBeenCalled();
});
it('exhausted quotas prevent a billable provider call', async () => {
  const fixture = enabledService(false);
  vi.mocked(postJson).mockResolvedValue({ text: 'masked fixture', count: 1, complete: true });
  await requestContext.run(context, () =>
    expect(fixture.service.generate(request())).rejects.toMatchObject({ code: 'VERBIS_AI_QUOTA' }),
  );
  expect(fixture.complete).not.toHaveBeenCalled();
});
it('unknown provider usage retains reservation and records failure', async () => {
  const fixture = enabledService();
  vi.mocked(postJson).mockResolvedValue({ text: 'masked fixture', count: 1, complete: true });
  fixture.complete.mockRejectedValue(new Error('synthetic timeout'));
  await requestContext.run(context, () =>
    expect(fixture.service.generate(request())).rejects.toMatchObject({
      code: 'VERBIS_AI_UNAVAILABLE',
    }),
  );
  const audit = JSON.stringify(fixture.audit.record.mock.calls);
  expect(audit).toContain('ai.call.finished');
  expect(audit).toContain('failure');
  expect(audit).not.toContain('synthetic timeout');
});

it('returns safe AI status/settings and saves configuration with an optimistic tenant version', async () => {
  const f = enabledService();
  expect(await f.service.status()).toEqual({ enabled: true, agentEnabled: false });
  expect(await f.service.settings()).toMatchObject({
    version: 1,
    available: true,
    endpoints: [
      { id: 'fixture', provider: 'onprem', residency: 'fixture', models: ['fixture-model'] },
    ],
  });
  const saved = await requestContext.run(context, () => f.service.save(1, f.config));
  expect(saved.config).toEqual(f.config);
  expect(f.audit.record).toHaveBeenCalledWith(
    f.tx,
    expect.objectContaining({ action: 'ai.configuration.changed' }),
  );
  f.tx.$executeRaw.mockResolvedValueOnce(0);
  await expect(requestContext.run(context, () => f.service.save(1, f.config))).rejects.toThrow();
  expect(f.complete).not.toHaveBeenCalled();
});
it.each([
  'disabledServer',
  'unknownEndpoint',
  'unknownModel',
  'missingSecretRef',
  'missingRedactor',
  'unknownSecret',
] as const)('rejects unsafe enabled configuration: %s', async (reason) => {
  const f = enabledService();
  let config = f.config;
  if (reason === 'disabledServer') f.env.AI_ENABLED = false;
  if (reason === 'unknownEndpoint') config = { ...config, endpointId: 'missing' };
  if (reason === 'unknownModel') config = { ...config, model: 'missing' };
  if (reason === 'missingSecretRef') config = { ...config, secretRef: null };
  if (reason === 'missingRedactor') f.env.AI_REDACTOR_JSON = '';
  if (reason === 'unknownSecret') f.tx.secret.findFirst.mockResolvedValue(null);
  await expect(requestContext.run(context, () => f.service.save(1, config))).rejects.toThrow();
  expect(f.tx.$executeRaw).not.toHaveBeenCalled();
  expect(f.audit.record).not.toHaveBeenCalled();
});
it('allows disabling AI without endpoints, but requires an authenticated actor', async () => {
  const f = enabledService();
  const disabled = AiConfigSchema.parse({});
  await expect(
    requestContext.run(
      { requestId: 'synthetic', correlationId: 'synthetic', ip: '', userAgent: 'test' },
      () => f.service.save(1, disabled),
    ),
  ).rejects.toThrow();
  f.env.AI_ENABLED = false;
  expect(await requestContext.run(context, () => f.service.save(1, disabled))).toMatchObject({
    available: false,
  });
  expect(f.tx.secret.findFirst).not.toHaveBeenCalled();
});

it.each(['reply', 'objection', 'summary'] as const)(
  'restricts agent %s proposals to owned session references and human approval',
  async (task) => {
    const f = enabledService(true, true);
    if (task === 'summary') f.row.state = 'wrapup';
    vi.mocked(postJson).mockResolvedValue({
      text: 'Synthetic masked transcript',
      count: 1,
      complete: true,
    });
    const proposal = {
      reply: 'Synthetic reply',
      summary: 'Synthetic summary',
      reason: 'Synthetic guidance',
      disposition: 'APPROVED',
      objectionNodeId: 'objection-approved',
    };
    f.complete.mockResolvedValue({
      text: JSON.stringify(proposal),
      inputTokens: 8,
      outputTokens: 4,
    });
    const result = await requestContext.run(context, () =>
      f.service.generate(
        AiRequestSchema.parse({
          requestId: request().requestId,
          task,
          sessionId: context.principal.id,
        }),
      ),
    );
    expect(result).toMatchObject({ task, requiresHumanApproval: true, value: proposal });
    expect(f.runtime.authorize).toHaveBeenCalledWith(f.row, true);
    const redactorRequest = vi.mocked(postJson).mock.calls.at(-1)![2] as { text: string };
    expect(redactorRequest.text).toContain('Synthetic customer transcript');
    expect(redactorRequest.text).toContain('objection-approved');
    expect(redactorRequest.text).toContain('APPROVED');
    expect(JSON.stringify(f.audit.record.mock.calls)).not.toContain(
      'Synthetic customer transcript',
    );
  },
);

it.each([
  'disabled',
  'missingSession',
  'file',
  'document',
  'preview',
  'voice',
  'completedReply',
  'activeSummary',
  'ownership',
] as const)('rejects unauthorized agent input: %s', async (reason) => {
  const f = enabledService(true, reason !== 'disabled');
  if (reason === 'preview') f.row.kind = 'preview';
  if (reason === 'voice') f.row.interaction.channelType = 'voice';
  if (reason === 'completedReply') f.row.state = 'completed';
  if (reason === 'ownership')
    f.runtime.authorize.mockImplementation(() => {
      throw new Error('Synthetic ownership denied');
    });
  const input = AiRequestSchema.parse({
    requestId: request().requestId,
    task: reason === 'activeSummary' ? 'summary' : 'reply',
    ...(reason === 'missingSession' ? {} : { sessionId: context.principal.id }),
    ...(reason === 'file' ? { file: { kind: 'pdf', base64: 'synthetic' } } : {}),
    ...(reason === 'document' ? { document: f.document } : {}),
  });
  await expect(requestContext.run(context, () => f.service.generate(input))).rejects.toThrow();
  expect(f.complete).not.toHaveBeenCalled();
  expect(f.tx.secret.findFirst).not.toHaveBeenCalled();
});

it.each(['objection', 'disposition'] as const)(
  'rejects invented agent %s references after the provider call',
  async (reference) => {
    const f = enabledService(true, true);
    vi.mocked(postJson).mockResolvedValue({
      text: 'Synthetic masked transcript',
      count: 0,
      complete: true,
    });
    f.complete.mockResolvedValue({
      text: JSON.stringify({
        reply: 'Synthetic',
        reason: 'Synthetic',
        ...(reference === 'objection'
          ? { objectionNodeId: 'invented' }
          : { disposition: 'invented' }),
      }),
      inputTokens: 8,
      outputTokens: 4,
    });
    await expect(
      requestContext.run(context, () =>
        f.service.generate(
          AiRequestSchema.parse({
            requestId: request().requestId,
            task: 'reply',
            sessionId: context.principal.id,
          }),
        ),
      ),
    ).rejects.toMatchObject({ code: 'VERBIS_AI_OUTPUT' });
    expect(JSON.stringify(f.audit.record.mock.calls)).toContain('failure');
  },
);

it('uses email context and permits an empty campaign outcome set without inventing a disposition', async () => {
  const f = enabledService(true, true);
  f.row.interaction.channelType = 'email';
  f.row.interaction.campaignId = null;
  f.runtime.interaction.mockReturnValue({ 'email.body': 'Synthetic email body' });
  f.runtime.snapshot.mockResolvedValue({ currentPage: 'other' });
  vi.mocked(postJson).mockResolvedValue({
    text: 'Synthetic masked email',
    count: 0,
    complete: true,
  });
  f.complete.mockResolvedValue({
    text: JSON.stringify({
      reply: 'Synthetic',
      reason: 'Synthetic',
      disposition: null,
      objectionNodeId: null,
    }),
    inputTokens: 8,
    outputTokens: 4,
  });
  await requestContext.run(context, () =>
    f.service.generate(
      AiRequestSchema.parse({
        requestId: request().requestId,
        task: 'reply',
        sessionId: context.principal.id,
      }),
    ),
  );
  expect(f.tx.campaign.findFirst).not.toHaveBeenCalled();
  expect((vi.mocked(postJson).mock.calls.at(-1)![2] as { text: string }).text).toContain(
    'Synthetic email body',
  );
});

it.each(['file', 'session', 'document', 'scenarios'] as const)(
  'rejects invalid designer task context before billing: %s',
  async (reason) => {
    const f = enabledService();
    const input = AiRequestSchema.parse({
      requestId: request().requestId,
      task: reason === 'scenarios' ? 'scenarios' : 'improve',
      ...(reason === 'file' ? { file: { kind: 'pdf', base64: 'synthetic' } } : {}),
      ...(reason === 'session' ? { sessionId: context.principal.id } : {}),
      ...(reason === 'document' ? { document: {} } : {}),
    });
    await expect(requestContext.run(context, () => f.service.generate(input))).rejects.toThrow();
    expect(f.complete).not.toHaveBeenCalled();
    expect(f.tx.$executeRaw).not.toHaveBeenCalled();
  },
);

it('enforces script read permission and rejects duplicate billable request IDs', async () => {
  const f = enabledService();
  vi.mocked(postJson).mockResolvedValue({
    text: 'Synthetic masked text',
    count: 0,
    complete: true,
  });
  f.tx.$executeRaw.mockImplementation((strings: TemplateStringsArray) =>
    Promise.resolve(strings[0]?.includes('INSERT INTO ai_calls') ? 0 : 1),
  );
  await expect(
    requestContext.run(context, () =>
      f.service.generate({ ...request(), scriptId: context.principal.id }),
    ),
  ).rejects.toMatchObject({ code: 'VERBIS_RESOURCE_CONFLICT' });
  expect(f.scripts.authorizeRead).toHaveBeenCalledWith(context.principal.id);
  expect(f.complete).not.toHaveBeenCalled();
});

it.each(['publicRedactor', 'changedConfiguration', 'overflow', 'invalidOutput'] as const)(
  'fails safely and accounts for provider risk: %s',
  async (reason) => {
    const f = enabledService();
    vi.mocked(postJson).mockResolvedValue({
      text: 'Synthetic masked text',
      count: 0,
      complete: true,
    });
    if (reason === 'publicRedactor')
      f.env.AI_REDACTOR_JSON = JSON.stringify({
        url: 'https://synthetic.example.invalid',
        addresses: ['8.8.8.8'],
      });
    if (reason === 'changedConfiguration') {
      f.tx.tenant.findFirstOrThrow
        .mockResolvedValueOnce({
          id: context.principal.tenantId,
          version: 1,
          status: 'active',
          settings: { ai: f.config },
        })
        .mockResolvedValue({
          id: context.principal.tenantId,
          version: 2,
          status: 'active',
          settings: { ai: { ...f.config, enabled: false } },
        });
    }
    if (reason === 'overflow')
      f.complete.mockResolvedValue({ text: '{}', inputTokens: 10_000_000, outputTokens: 4 });
    if (reason === 'invalidOutput')
      f.complete.mockResolvedValue({ text: '{}', inputTokens: 8, outputTokens: 4 });
    await expect(
      requestContext.run(context, () => f.service.generate(request())),
    ).rejects.toMatchObject({
      code:
        reason === 'changedConfiguration'
          ? 'VERBIS_AI_DISABLED'
          : reason === 'publicRedactor'
            ? 'VERBIS_AI_UNAVAILABLE'
            : 'VERBIS_AI_OUTPUT',
    });
    if (reason === 'publicRedactor' || reason === 'changedConfiguration')
      expect(f.complete).not.toHaveBeenCalled();
    if (reason === 'overflow')
      expect(JSON.stringify(f.audit.record.mock.calls)).toContain('ai.configuration.disabled');
  },
);

it('returns current monthly usage and reconciles stale reservations without refunding unknown billing', async () => {
  const f = enabledService();
  expect(await f.service.usage()).toMatchObject({ tokens: 0, microUsd: 0, calls: 0, pending: 0 });
  f.tx.$queryRaw.mockResolvedValueOnce([{ tokens: 123n, micro_usd: 456n, calls: 7, pending: 2 }]);
  expect(await f.service.usage()).toMatchObject({
    tokens: 123,
    microUsd: 456,
    calls: 7,
    pending: 2,
  });
  f.tx.$queryRaw.mockResolvedValueOnce([
    { id: context.principal.id, month: new Date('2026-10-01T00:00:00Z') },
  ]);
  expect(await f.service.reconcile()).toEqual({ reconciled: 1 });
  expect(JSON.stringify(f.audit.record.mock.calls)).toContain('STALE_FULL_RESERVATION_RETAINED');
  expect(f.tx.$executeRaw.mock.calls.some(([sql]) => sql.join('').includes('tokens=tokens-'))).toBe(
    false,
  );
});

describe('navigate (ADR-0052 E4)', () => {
  const twoPages = () => {
    const doc = ScriptDocumentSchema.parse(minimalScript());
    const first = doc.pages[0]!;
    doc.pages.push({
      ...structuredClone(first),
      id: 'refunds',
      name: 'Refunds',
      layout: { ...structuredClone(first.layout), id: 'refunds-root', children: [] },
    });
    return doc;
  };
  const ask = (f: ReturnType<typeof enabledService>) =>
    requestContext.run(context, () =>
      f.service.generate(
        AiRequestSchema.parse({
          requestId: request().requestId,
          task: 'navigate',
          sessionId: context.principal.id,
        }),
      ),
    );
  const setup = (output: unknown) => {
    const f = enabledService(true, true);
    f.runtime.document = () => twoPages();
    vi.mocked(postJson).mockResolvedValue({
      text: 'Synthetic masked transcript',
      count: 0,
      complete: true,
    });
    f.complete.mockResolvedValue({
      text: JSON.stringify(output),
      inputTokens: 8,
      outputTokens: 4,
    });
    return f;
  };

  it('offers only the other pages of the pinned script and returns a reviewed suggestion', async () => {
    const f = setup({ pageId: 'refunds', reason: 'Customer asks for a refund' });
    const result = await ask(f);
    expect(result).toMatchObject({
      task: 'navigate',
      requiresHumanApproval: true,
      value: { pageId: 'refunds' },
    });
    const sent = (vi.mocked(postJson).mock.calls.at(-1)![2] as { text: string }).text;
    // Only the page that is not currently shown is offered as a choice.
    expect(sent).toContain('"pageChoices":[{"id":"refunds","name":"Refunds"}]');
  });

  it('accepts "no page fits" and refuses a page the script does not have or the one already shown', async () => {
    expect(await ask(setup({ pageId: null, reason: 'Nothing fits' }))).toMatchObject({
      value: { pageId: null },
    });
    await expect(ask(setup({ pageId: 'invented', reason: 'x' }))).rejects.toMatchObject({
      code: 'VERBIS_AI_OUTPUT',
    });
    await expect(ask(setup({ pageId: 'home', reason: 'already here' }))).rejects.toMatchObject({
      code: 'VERBIS_AI_OUTPUT',
    });
  });

  it('is only available while the interaction is live', async () => {
    const f = setup({ pageId: 'refunds', reason: 'x' });
    f.row.state = 'wrapup';
    await expect(ask(f)).rejects.toMatchObject({ code: 'VERBIS_AUTHZ_FORBIDDEN' });
    expect(f.complete).not.toHaveBeenCalled();
  });
});

describe('notices (ADR-0052 E5)', () => {
  const withNotices = () => {
    const doc = ScriptDocumentSchema.parse(minimalScript());
    doc.i18n.messages['en'] = {
      ...doc.i18n.messages['en'],
      'legal.text': 'This call may be recorded.',
    };
    doc.pages[0]!.layout.children = [
      {
        id: 'notice-recording',
        type: 'scriptText',
        props: { mustRead: true, textKey: 'legal.text' },
        bindings: [],
        events: {},
      },
    ] as never;
    return doc;
  };
  const setup = (output: unknown) => {
    const f = enabledService(true, true);
    f.runtime.document = () => withNotices();
    vi.mocked(postJson).mockResolvedValue({
      text: 'Synthetic masked transcript',
      count: 0,
      complete: true,
    });
    f.complete.mockResolvedValue({ text: JSON.stringify(output), inputTokens: 8, outputTokens: 4 });
    return f;
  };
  const ask = (f: ReturnType<typeof enabledService>) =>
    requestContext.run(context, () =>
      f.service.generate(
        AiRequestSchema.parse({
          requestId: request().requestId,
          task: 'notices',
          locale: 'en',
          sessionId: context.principal.id,
        }),
      ),
    );

  it('sends the notice wording and returns only ids the script defines, as a suggestion', async () => {
    const f = setup({ noticeIds: ['notice-recording'], reason: 'The operator read it out' });
    const result = await ask(f);
    expect(result).toMatchObject({
      task: 'notices',
      requiresHumanApproval: true,
      value: { noticeIds: ['notice-recording'] },
    });
    const sent = (vi.mocked(postJson).mock.calls.at(-1)![2] as { text: string }).text;
    expect(sent).toContain('This call may be recorded.');
    expect(sent).toContain('noticeChoices');
  });

  it('accepts "none said" and refuses an invented notice id', async () => {
    expect(await ask(setup({ noticeIds: [], reason: 'Nothing matched' }))).toMatchObject({
      value: { noticeIds: [] },
    });
    await expect(ask(setup({ noticeIds: ['invented'], reason: 'x' }))).rejects.toMatchObject({
      code: 'VERBIS_AI_OUTPUT',
    });
  });
});
