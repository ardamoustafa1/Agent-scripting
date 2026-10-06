import nodemailer from 'nodemailer';
import { afterEach, expect, it, vi } from 'vitest';

import { createAbility } from '@verbis/authz';
import { AnalyticsScheduleSchema } from '@verbis/shared-types';

import { EventEnvelopeSchema } from '../../infra/outbox/outbox.types.js';

import { fixtureFact, fixtureId } from './fixtures.js';
import { AnalyticsReportConsumer, AnalyticsReportScheduler } from './reports.js';

import type { AnalyticsStore } from './storage.js';
import type { ApiEnv } from '../../env.js';
import type { PrismaService, TransactionClient } from '../../infra/database/prisma.service.js';
import type { TenantDb } from '../../infra/database/tenant-db.js';
import type { AuditService } from '../audit/audit.service.js';
import type { AbilityFactory } from '../authz/ability.factory.js';

const tenant = fixtureId(1),
  owner = fixtureId(7),
  recipient = fixtureId(8);
const definition = AnalyticsScheduleSchema.parse({
  filter: { from: '2026-09-01', to: '2026-09-08' },
  frequency: 'daily',
  hourUtc: 8,
  enabled: true,
  recipientUserIds: [recipient],
});
const event = EventEnvelopeSchema.parse({
  id: fixtureId(9),
  tenantId: tenant,
  type: 'verbis.analytics.report.requested.v1',
  aggregate: { type: 'Report', id: fixtureId(10) },
  occurredAt: '2026-10-04T08:00:00Z',
  correlationId: 'synthetic',
  actor: 'scheduler',
  payload: { scheduleId: fixtureId(10), runAt: '2026-10-04T08:00:00Z' },
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function fixture(enabled = true) {
  const env = {
    ANALYTICS_ENABLED: true,
    ANALYTICS_REPORTS_ENABLED: enabled,
    ANALYTICS_SMTP_URL: 'smtp://synthetic.invalid',
    ANALYTICS_MAIL_FROM: 'synthetic@example.invalid',
  } as ApiEnv;
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ owner_id: owner, definition }]),
    $executeRaw: vi.fn().mockResolvedValue(1),
    tenant: { findUnique: vi.fn().mockResolvedValue({ settings: {} }) },
    user: { findFirst: vi.fn().mockResolvedValue({ email: 'synthetic@example.invalid' }) },
  };
  const store = {
    read: vi.fn().mockResolvedValue([fixtureFact(0), fixtureFact(1)]),
    purge: vi.fn().mockResolvedValue(undefined),
  };
  const abilities = {
    forPrincipal: vi
      .fn()
      .mockResolvedValue({ ability: createAbility([{ action: 'manage', subject: 'all' }]) }),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const sendMail = vi.fn().mockResolvedValue({});
  vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as unknown as ReturnType<
    typeof nodemailer.createTransport
  >);
  const consumer = new AnalyticsReportConsumer(
    env,
    abilities as unknown as AbilityFactory,
    store as unknown as AnalyticsStore,
    audit as unknown as AuditService,
  );
  return {
    consumer,
    env,
    tx,
    store,
    abilities,
    audit,
    sendMail,
    transaction: tx as unknown as TransactionClient,
  };
}
it('delivers a recipient-authorized CSV with a stable event message ID and shifted date window', async () => {
  const f = fixture();
  expect(f.consumer.enabled).toBe(true);
  await f.consumer.handle(event, f.transaction);
  expect(f.store.read).toHaveBeenCalledWith(
    f.tx,
    tenant,
    expect.objectContaining({ from: '2026-09-26', to: '2026-10-03' }),
  );
  expect(f.sendMail).toHaveBeenCalledWith(
    expect.objectContaining({
      to: 'synthetic@example.invalid',
      messageId: `<${event.id}.${recipient}@reports.verbis>`,
      attachments: [
        expect.objectContaining({
          filename: 'analytics.csv',
          content: expect.stringContaining('completionRate') as unknown,
        }),
      ],
    }),
  );
  expect(f.audit.record).toHaveBeenCalledWith(
    f.tx,
    expect.objectContaining({ action: 'analytics.report.delivered' }),
  );
});
it.each([
  'disabledDelivery',
  'missingSchedule',
  'disabledSchedule',
  'missingTenant',
  'ownerDenied',
  'missingRecipient',
  'recipientDenied',
] as const)('prevents unauthorized report delivery for %s', async (reason) => {
  const f = fixture(reason !== 'disabledDelivery');
  if (reason === 'missingSchedule') f.tx.$queryRaw.mockResolvedValue([]);
  if (reason === 'disabledSchedule')
    f.tx.$queryRaw.mockResolvedValue([
      { owner_id: owner, definition: { ...definition, enabled: false } },
    ]);
  if (reason === 'missingTenant') f.tx.tenant.findUnique.mockResolvedValue(null);
  if (reason === 'ownerDenied')
    f.abilities.forPrincipal.mockResolvedValue({ ability: createAbility([]) });
  if (reason === 'missingRecipient') f.tx.user.findFirst.mockResolvedValue(null);
  if (reason === 'recipientDenied')
    f.abilities.forPrincipal
      .mockResolvedValueOnce({ ability: createAbility([{ action: 'manage', subject: 'all' }]) })
      .mockResolvedValueOnce(null);
  if (reason === 'disabledDelivery')
    await expect(f.consumer.handle(event, f.transaction)).rejects.toThrow(
      'Report delivery disabled',
    );
  else await f.consumer.handle(event, f.transaction);
  expect(f.sendMail).not.toHaveBeenCalled();
});
it('filters facts against both owner and recipient export scopes', async () => {
  const f = fixture();
  const allowed = fixtureFact(0),
    excluded = fixtureFact(1, { campaignId: fixtureId(20) });
  f.store.read.mockResolvedValue([allowed, excluded]);
  const ability = createAbility([
    { action: 'manage', subject: 'Report' },
    {
      action: ['read', 'export'],
      subject: 'Report',
      conditions: { campaignId: allowed.campaignId },
    },
  ]);
  // A broad manage rule would imply export; use separate ability for the recipient.
  const recipientAbility = createAbility([
    {
      action: ['read', 'export'],
      subject: 'Report',
      conditions: { campaignId: allowed.campaignId },
    },
  ]);
  f.abilities.forPrincipal
    .mockResolvedValueOnce({ ability })
    .mockResolvedValueOnce({ ability: recipientAbility });
  await f.consumer.handle(event, f.transaction);
  expect(f.sendMail).toHaveBeenCalledTimes(1);
  const mail = f.sendMail.mock.calls[0]![0] as { attachments: { content: string }[] };
  expect(mail.attachments[0]!.content).toContain(allowed.campaignId!);
  expect(mail.attachments[0]!.content).not.toContain(excluded.campaignId!);
});
it('makes mail failure retryable and avoids recording a successful delivery', async () => {
  const f = fixture();
  f.sendMail.mockRejectedValue(new Error('synthetic smtp error'));
  await expect(f.consumer.handle(event, f.transaction)).rejects.toThrow(
    'Analytics report mail delivery failed',
  );
  expect(f.audit.record).not.toHaveBeenCalled();
});
function scheduler(reports = false, settings: unknown = {}) {
  const f = fixture(reports);
  const raw = vi
    .fn()
    .mockImplementation((sql: TemplateStringsArray) =>
      Promise.resolve(
        sql.join('').includes('FOR SHARE')
          ? [{ settings }]
          : [{ id: fixtureId(10), definition, next_run_at: new Date('2026-10-04T08:00:00Z') }],
      ),
    );
  f.tx.$queryRaw = raw;
  const prisma = { client: { $queryRaw: vi.fn().mockResolvedValue([{ id: tenant, settings }]) } };
  const db = {
    run: vi
      .fn()
      .mockImplementation((_tenant: string, work: (tx: TransactionClient) => Promise<void>) =>
        work(f.transaction),
      ),
  };
  const outbox = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new AnalyticsReportScheduler(
    f.env,
    prisma as unknown as PrismaService,
    db as unknown as TenantDb,
    outbox,
    f.store as unknown as AnalyticsStore,
  );
  return { ...f, prisma, db, outbox, service };
}
it.each([{}, { audit: { legalHold: true } }, { audit: { analyticsRetentionDays: -1 } }, null])(
  'purges only valid retention settings without a legal hold: %j',
  async (settings) => {
    const f = scheduler(false, settings);
    await f.service.tick();
    expect(f.store.purge).toHaveBeenCalledTimes(
      settings !== null && Object.keys(settings).length === 0 ? 1 : 0,
    );
    expect(f.outbox.record).not.toHaveBeenCalled();
  },
);
it('queues due schedules and advances them in the same tenant transaction', async () => {
  const f = scheduler(true);
  await f.service.tick();
  expect(f.outbox.record).toHaveBeenCalledWith(
    f.tx,
    expect.objectContaining({
      type: event.type,
      aggregateId: fixtureId(10),
      payload: { scheduleId: fixtureId(10), runAt: '2026-10-04T08:00:00.000Z' },
    }),
  );
  expect(f.tx.$executeRaw).toHaveBeenCalledTimes(1);
});
it('prevents overlapping ticks and resets the guard after database failure', async () => {
  const f = scheduler();
  let resolve!: (rows: never[]) => void;
  f.prisma.client.$queryRaw.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const pending = f.service.tick();
  await f.service.tick();
  expect(f.prisma.client.$queryRaw).toHaveBeenCalledTimes(1);
  resolve([]);
  await pending;
  f.prisma.client.$queryRaw.mockRejectedValueOnce(new Error('synthetic database failure'));
  await expect(f.service.tick()).rejects.toThrow();
  await f.service.tick();
  expect(f.prisma.client.$queryRaw).toHaveBeenCalledTimes(3);
});
it('requires SMTP configuration before starting report maintenance and releases its timer', () => {
  vi.useFakeTimers();
  const f = scheduler(true);
  f.env.ANALYTICS_SMTP_URL = undefined;
  expect(() => {
    f.service.onApplicationBootstrap();
  }).toThrow('SMTP configuration');
  f.env.ANALYTICS_SMTP_URL = 'smtp://synthetic.invalid';
  f.service.onApplicationBootstrap();
  expect(vi.getTimerCount()).toBe(1);
  f.service.onApplicationShutdown();
  expect(vi.getTimerCount()).toBe(0);
  f.env.ANALYTICS_ENABLED = false;
  f.service.onApplicationBootstrap();
  expect(vi.getTimerCount()).toBe(0);
});
