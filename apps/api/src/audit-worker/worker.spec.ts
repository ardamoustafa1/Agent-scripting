import { describe, expect, it, vi } from 'vitest';

import { parsePartition, retentionElapsed } from './archive.job.js';
import { workerEnv, WorkerConfigError } from './audit-worker.module.js';
import {
  actionFromSubject,
  actorFromRef,
  DomainEventAuditHandler,
} from './domain-event-audit.handler.js';
import { IntervalJob } from './interval-job.js';
import { EnvSecretResolver, MissingSecretError } from './secret-resolver.js';
import { backoffSeconds, describeDeliveryError } from './siem.dispatcher.js';
import { parseTenantAudit } from './tenants.js';

import type { ApiEnv } from '../env.js';
import type { TransactionClient } from '../infra/database/prisma.service.js';
import type { AuditService } from '../modules/audit/audit.service.js';

describe('domain event → audit', () => {
  it('derives actor and action', () => {
    expect(actorFromRef('user:u-1')).toEqual({ type: 'user', id: 'u-1' });
    expect(actorFromRef('service:crm')).toEqual({ type: 'apiClient', id: 'crm' });
    expect(actorFromRef('connector:genesys:eu')).toEqual({ type: 'connector', id: 'genesys:eu' });
    expect(actorFromRef('system')).toEqual({ type: 'system', id: 'system' });
    expect(actorFromRef('')).toEqual({ type: 'system', id: 'unknown' });
    expect(actionFromSubject('verbis.campaigns.campaign.created.v1')).toBe(
      'campaigns.campaign.created',
    );
  });

  const event = {
    id: '0199a000-0000-7000-8000-0000000000e1',
    type: 'verbis.connectors.connector.updated.v1',
    tenantId: '0199a000-0000-7000-8000-000000000001',
    aggregate: { type: 'Connector', id: 'k-1' },
    occurredAt: '2026-10-01T10:00:00.000Z',
    correlationId: 'corr-9',
    actor: 'connector:genesys',
    payload: {},
  };

  it('audits events whose request wrote no audit event', async () => {
    const recordMany = vi.fn(() => Promise.resolve([]));
    const handler = new DomainEventAuditHandler({ recordMany } as unknown as AuditService);
    const tx = {
      $queryRaw: vi.fn(() => Promise.resolve([{ found: false }])),
    } as unknown as TransactionClient;
    await handler.handle(event, tx);
    expect(recordMany).toHaveBeenCalledWith(
      tx,
      [
        expect.objectContaining({
          action: 'connectors.connector.updated',
          actor: { type: 'connector', id: 'genesys' },
          target: { type: 'Connector', id: 'k-1' },
          occurredAt: new Date(event.occurredAt),
        }),
      ],
      { tenantId: event.tenantId },
    );
  });

  it('skips events already covered by a request audit (same correlation id)', async () => {
    const recordMany = vi.fn();
    const handler = new DomainEventAuditHandler({ recordMany } as unknown as AuditService);
    await handler.handle(event, {
      $queryRaw: () => Promise.resolve([{ found: true }]),
    } as unknown as TransactionClient);
    expect(recordMany).not.toHaveBeenCalled();
  });
});

describe('SIEM retry policy', () => {
  it('backs off exponentially with jitter and a cap', () => {
    expect(backoffSeconds(1, 300, () => 1)).toBe(2);
    expect(backoffSeconds(5, 300, () => 1)).toBe(32);
    expect(backoffSeconds(30, 300, () => 1)).toBe(300);
    expect(backoffSeconds(3, 300, () => 0)).toBe(1);
  });

  it('stores bounded error text without URLs', () => {
    expect(
      describeDeliveryError(new Error('connect to https://hook.example.test/x?token=abc failed')),
    ).toBe('Error: connect to <url> failed');
    expect(describeDeliveryError('x')).toBe('unknown error');
    expect(describeDeliveryError(new Error('y'.repeat(1000))).length).toBe(300);
  });
});

describe('partitions and retention', () => {
  it('parses monthly partition names', () => {
    expect(parsePartition('audit_events_y2026m10')).toEqual({
      name: 'audit_events_y2026m10',
      parent: 'audit_events',
      stream: 'audit',
      start: new Date('2026-10-01T00:00:00Z'),
      end: new Date('2026-11-01T00:00:00Z'),
    });
    expect(parsePartition('session_events_y2026m12')?.end).toEqual(
      new Date('2027-01-01T00:00:00Z'),
    );
    expect(parsePartition('audit_events_default')).toBeUndefined();
    expect(parsePartition('users')).toBeUndefined();
  });

  it('retention counts from the end of the partition, per stream', () => {
    const p = parsePartition('audit_events_y2026m01')!;
    const s = parsePartition('session_events_y2026m01')!;
    const tenant = { id: 't', retentionDays: 365, sessionRetentionDays: 30, legalHold: false };
    expect(retentionElapsed(p, tenant, new Date('2027-01-31T00:00:00Z'))).toBe(false);
    expect(retentionElapsed(p, tenant, new Date('2027-02-01T00:00:00Z'))).toBe(true);
    expect(retentionElapsed(s, tenant, new Date('2026-03-03T00:00:00Z'))).toBe(true);
  });

  it('tenant settings: defaults, explicit values, and fail-safe on malformed settings', () => {
    expect(parseTenantAudit('t', {}, 3650)).toEqual({
      id: 't',
      retentionDays: 3650,
      sessionRetentionDays: 3650,
      legalHold: false,
    });
    expect(parseTenantAudit('t', { audit: { retentionDays: 400, legalHold: true } }, 3650)).toEqual(
      { id: 't', retentionDays: 400, sessionRetentionDays: 400, legalHold: true },
    );
    expect(parseTenantAudit('t', { audit: { retentionDays: 1 } }, 3650)).toEqual({
      id: 't',
      retentionDays: 36_500,
      sessionRetentionDays: 36_500,
      legalHold: true,
    });
  });
});

describe('worker configuration', () => {
  const base = {
    DATABASE_APP_URL: 'postgres://app',
    OUTBOX_RELAY_ENABLED: true,
  } as unknown as ApiEnv;

  it('requires its own DB role and a signing key; disables the outbox relay', () => {
    expect(() => workerEnv(base)).toThrow(WorkerConfigError);
    expect(() => workerEnv({ ...base, AUDIT_WORKER_DATABASE_URL: 'postgres://w' })).toThrow(
      /SIGNING_JWK/,
    );
    const env = workerEnv({
      ...base,
      AUDIT_WORKER_DATABASE_URL: 'postgres://w',
      AUDIT_CHECKPOINT_SIGNING_JWK: '{}',
    });
    expect(env.DATABASE_APP_URL).toBe('postgres://w');
    expect(env.OUTBOX_RELAY_ENABLED).toBe(false);
    expect(env.EVENT_CONSUMERS_ENABLED).toBe(true);
  });

  it('resolves secret references from the (dev) env store only', async () => {
    const resolver = new EnvSecretResolver({ VERBIS_SECRET_SIEM_HOOK: 's3cr3t' });
    await expect(resolver.resolve('t', 'secret://siem-hook')).resolves.toBe('s3cr3t');
    await expect(resolver.resolve('t', 'secret://missing')).rejects.toBeInstanceOf(
      MissingSecretError,
    );
    await expect(resolver.resolve('t', 'env:PATH')).rejects.toBeInstanceOf(MissingSecretError);
  });
});

describe('IntervalJob', () => {
  it('never overlaps itself and survives failures', async () => {
    let running = 0;
    let max = 0;
    let calls = 0;
    const job = new IntervalJob('t', 10, async () => {
      calls += 1;
      running += 1;
      max = Math.max(max, running);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
      if (calls === 2) throw new Error('boom');
    });
    job.start();
    job.wake();
    job.wake();
    await new Promise((r) => setTimeout(r, 80));
    job.stop();
    expect(max).toBe(1);
    expect(calls).toBeGreaterThanOrEqual(3);
  });
});
