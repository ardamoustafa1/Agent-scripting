import { describe, expect, it, vi } from 'vitest';

import { TriggerSchema, type ScriptTriggerInput } from '@verbis/script-schema';

import { NotFoundError } from '../../common/errors/domain-errors.js';

import { maskCardNumbers, RESOLVED, TRIGGERED, TranscriptService } from './transcript.service.js';

import type { RuntimeEngineService } from './runtime-engine.service.js';
import type { RuntimeGateway } from './runtime.gateway.js';
import type { TranscriptStore } from './transcript.store.js';
import type { TenantDb } from '../../infra/database/tenant-db.js';
import type { AuditService } from '../audit/audit.service.js';

const TENANT = '0190f000-0000-7000-8000-00000000aaaa';
const CALL = '0190f000-0000-7000-8000-00000000cccc';
const SESSION = '0190f000-0000-7000-8000-00000000dddd';
const CONNECTOR = '0190f000-0000-7000-8000-00000000eeee';

const trigger = (input: Partial<ScriptTriggerInput> = {}) =>
  TriggerSchema.parse({
    id: 'cancel-intent',
    name: 'Cancel',
    phrases: { tr: ['iptal etmek'] },
    actions: [
      { type: 'suggestPage', pageId: 'retention' },
      { type: 'alert', messageKey: 'hint.cancel' },
    ],
    ...input,
  });
const segment = (segmentId: string, text = 'Aboneliğimi iptal etmek istiyorum', final = true) => ({
  segmentId,
  platformInteractionId: 'sim-1',
  speaker: 'customer' as const,
  text,
  final,
  occurredAt: '2026-10-22T10:00:00.000Z',
});

function harness(
  options: {
    enabled?: boolean;
    state?: string;
    triggers?: ReturnType<typeof trigger>[];
    currentPage?: string | null;
    first?: boolean;
  } = {},
) {
  const events: { type: string; payload: unknown; recordedAt: Date; seq: number }[] = [];
  const tx = {
    tenant: {
      findFirst: vi.fn().mockResolvedValue({
        settings: { liveTranscript: { enabled: options.enabled ?? true } },
      }),
    },
    session: { findMany: vi.fn().mockResolvedValue([{ id: SESSION }]) },
    sessionEvent: {
      findMany: vi.fn(({ where }: { where: { type: { in: string[] } } }) =>
        Promise.resolve(
          events
            .filter((event) => where.type.in.includes(event.type))
            .slice()
            .reverse(),
        ),
      ),
    },
  };
  const row = {
    id: SESSION,
    tenantId: TENANT,
    interactionId: CALL,
    state: options.state ?? 'active',
  };
  const engine = {
    row: vi.fn().mockResolvedValue(row),
    document: vi.fn().mockReturnValue({ triggers: options.triggers ?? [trigger()] }),
    snapshot: vi.fn().mockResolvedValue({ currentPage: options.currentPage ?? 'home' }),
    save: vi.fn((_row: unknown, _snapshot: unknown, _state: string, type: string, payload) => {
      events.push({ type, payload, recordedAt: new Date(), seq: events.length + 1 });
      return Promise.resolve({});
    }),
  };
  const store = {
    append: vi.fn().mockResolvedValue({ stored: true, first: options.first ?? false }),
    read: vi.fn().mockResolvedValue([{ segmentId: 's1' }]),
  };
  const gateway = { transcript: vi.fn().mockReturnValue(true) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new TranscriptService(
    { current: () => tx, tenantId: () => TENANT } as unknown as TenantDb,
    engine as unknown as RuntimeEngineService,
    store as unknown as TranscriptStore,
    gateway as unknown as RuntimeGateway,
    audit as unknown as AuditService,
  );
  const interaction = { id: CALL, status: 'connected', connectorId: CONNECTOR };
  return { service, tx, engine, store, gateway, audit, events, row, interaction };
}

describe('TranscriptService.receive', () => {
  it('discards everything unless the tenant opted in or while the interaction is ended', async () => {
    const off = harness({ enabled: false });
    expect(await off.service.receive(off.interaction, segment('s1'))).toEqual({ accepted: false });
    const ended = harness();
    expect(
      await ended.service.receive({ ...ended.interaction, status: 'ended' }, segment('s1')),
    ).toEqual({ accepted: false });
    for (const h of [off, ended]) {
      expect(h.store.append).not.toHaveBeenCalled();
      expect(h.gateway.transcript).not.toHaveBeenCalled();
      expect(h.engine.save).not.toHaveBeenCalled();
    }
  });

  it('stores final lines, audits the first one without text and pushes to the owner', async () => {
    const h = harness({ first: true });
    expect(await h.service.receive(h.interaction, segment('s1'))).toEqual({ accepted: true });
    expect(h.store.append).toHaveBeenCalledWith(
      TENANT,
      CALL,
      expect.objectContaining({ segmentId: 's1', final: true }),
    );
    expect(h.audit.record).toHaveBeenCalledTimes(1);
    const [, audited] = h.audit.record.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(audited['action']).toBe('runtime.transcript.started');
    expect(JSON.stringify(audited)).not.toContain('iptal');
    expect(h.gateway.transcript).toHaveBeenCalledWith(
      TENANT,
      SESSION,
      expect.objectContaining({ text: 'Aboneliğimi iptal etmek istiyorum' }),
    );
  });

  it('pushes interim lines live without storing or evaluating them', async () => {
    const h = harness();
    await h.service.receive(h.interaction, segment('s1', 'iptal etmek', false));
    expect(h.gateway.transcript).toHaveBeenCalledTimes(1);
    expect(h.store.append).not.toHaveBeenCalled();
    expect(h.engine.save).not.toHaveBeenCalled();
  });

  it('records a hit as a session event with ids only and never twice', async () => {
    const h = harness();
    await h.service.receive(h.interaction, segment('s1'));
    expect(h.engine.save).toHaveBeenCalledTimes(1);
    expect(h.events).toEqual([
      expect.objectContaining({
        type: TRIGGERED,
        payload: { triggerIds: ['cancel-intent'], speaker: 'customer', segmentId: 's1' },
      }),
    ]);
    expect(JSON.stringify(h.events)).not.toContain('Aboneliğimi');
    await h.service.receive(h.interaction, segment('s1'));
    await h.service.receive(h.interaction, segment('s2'));
    expect(h.engine.save).toHaveBeenCalledTimes(1);
  });

  it('does not evaluate closed, wrap-up or trigger-less sessions', async () => {
    for (const options of [{ state: 'completed' }, { state: 'wrapup' }, { triggers: [] }]) {
      const h = harness(options);
      await h.service.receive(h.interaction, segment('s1'));
      expect(h.engine.save).not.toHaveBeenCalled();
      expect(h.gateway.transcript).toHaveBeenCalledTimes(options.state === 'completed' ? 0 : 1);
    }
  });

  it('ignores text that matches no phrase', async () => {
    const h = harness();
    await h.service.receive(h.interaction, segment('s1', 'Faturamı soracaktım'));
    expect(h.engine.save).not.toHaveBeenCalled();
  });
});

describe('TranscriptService prompts', () => {
  it('lists pending prompts newest first and hides a suggestion of the page shown', async () => {
    const second = trigger({
      id: 'price',
      phrases: { tr: ['pahalı'] },
      actions: [{ type: 'markNotice', noticeId: 'price-notice' }],
    });
    const h = harness({ triggers: [trigger(), second] });
    await h.service.receive(h.interaction, segment('s1'));
    await h.service.receive(h.interaction, segment('s2', 'çok pahalı'));
    const prompts = await h.service.prompts(h.row as never, 'home');
    expect(prompts.map((p) => p.triggerId)).toEqual(['price', 'cancel-intent']);
    expect(prompts[1]?.actions).toHaveLength(2);
    const onTarget = await h.service.prompts(h.row as never, 'retention');
    expect(onTarget.find((p) => p.triggerId === 'cancel-intent')?.actions).toEqual([
      { type: 'alert', messageKey: 'hint.cancel', tone: 'info' },
    ]);
  });

  it('resolves only a pending prompt, once', async () => {
    const h = harness();
    await h.service.receive(h.interaction, segment('s1'));
    await expect(h.service.resolve(h.row as never, 'unknown', 'dismissed')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await h.service.resolve(h.row as never, 'cancel-intent', 'accepted');
    expect(h.events.at(-1)).toMatchObject({
      type: RESOLVED,
      payload: { triggerId: 'cancel-intent', resolution: 'accepted' },
    });
    expect(await h.service.prompts(h.row as never, 'home')).toEqual([]);
    await expect(
      h.service.resolve(h.row as never, 'cancel-intent', 'dismissed'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('a trigger that fires again after resolution shows again', async () => {
    const h = harness({ triggers: [trigger({ repeat: { cooldownSeconds: 10 } })] });
    await h.service.receive(h.interaction, segment('s1'));
    await h.service.resolve(h.row as never, 'cancel-intent', 'dismissed');
    for (const event of h.events) event.recordedAt = new Date(Date.now() - 60_000);
    await h.service.receive(h.interaction, segment('s2'));
    expect((await h.service.prompts(h.row as never, 'home')).map((p) => p.segmentId)).toEqual([
      's2',
    ]);
  });
});

describe('TranscriptService.window', () => {
  it('returns the stored lines to the owner and audits the read', async () => {
    const h = harness();
    expect(await h.service.window(h.row as never)).toEqual({
      enabled: true,
      lines: [{ segmentId: 's1' }],
    });
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'runtime.transcript.viewed', metadata: { lines: 1 } }),
    );
  });

  it('reads nothing when the tenant opted out', async () => {
    const h = harness({ enabled: false });
    expect(await h.service.window(h.row as never)).toEqual({ enabled: false, lines: [] });
    expect(h.store.read).not.toHaveBeenCalled();
    expect(h.audit.record).not.toHaveBeenCalled();
  });
});

describe('maskCardNumbers (PCI-DSS req. 3)', () => {
  it.each([
    ['Kart numaram 4111 1111 1111 1111 tamam mı', 'Kart numaram •••• 1111 tamam mı'],
    ['4111-1111-1111-1111', '•••• 1111'],
    ['5500000000000004', '•••• 0004'],
    ['numara 4111 1111 1111 1111 1227 son kullanma', 'numara •••• 1227 son kullanma'],
  ])('masks %s', (text, masked) => {
    expect(maskCardNumbers(text)).toBe(masked);
  });

  it.each([
    'Telefonum 0532 123 45 67',
    'Sipariş 1234567890123',
    'TC kimlik 10000000146',
    'Fatura tutarı 1.250 TL',
  ])('keeps %s', (text) => {
    expect(maskCardNumbers(text)).toBe(text);
  });

  it('never stores, pushes or evaluates the card number', async () => {
    const h = harness({
      first: true,
      triggers: [trigger({ phrases: { tr: ['4111'] } })],
    });
    await h.service.receive(h.interaction, segment('s1', 'kartım 4111 1111 1111 1111'));
    const stored = JSON.stringify([h.store.append.mock.calls, h.gateway.transcript.mock.calls]);
    expect(stored).not.toContain('4111 1111 1111 1111');
    expect(stored).toContain('•••• 1111');
    expect(h.engine.save).not.toHaveBeenCalled();
  });
});
