import { describe, expect, it } from 'vitest';

import {
  AUDIT_ACTION,
  GENESIS_HASH,
  hashEventV1,
  hashEventV2,
  recomputeHash,
  rowToEvent,
  type ChainedAuditEvent,
  type StoredAuditRow,
} from './audit-event.js';

export function storedRow(overrides: Partial<StoredAuditRow> = {}): StoredAuditRow {
  const base: Omit<StoredAuditRow, 'hash'> = {
    id: '01J0000000000000000000000A',
    tenantId: '0199a000-0000-7000-8000-000000000001',
    seq: 1n,
    hashVersion: 2,
    action: 'script.version.published',
    actorType: 'user',
    actorId: 'u-1',
    actor: { ip: '10.0.0.1', sessionId: 's-1' },
    targetType: 'ScriptVersion',
    targetId: 'v-1',
    targetName: 'Card sales v3',
    outcome: 'success',
    reason: null,
    diff: { mode: 'snapshot', before: { state: 'in_review' }, after: { state: 'published' } },
    correlationId: 'c-1',
    interactionId: null,
    metadata: {},
    occurredAt: new Date('2026-10-01T10:00:00.123Z'),
    recordedAt: new Date('2026-10-01T10:00:00.125Z'),
    prevHash: GENESIS_HASH,
    ...overrides,
  };
  const row = { ...base, hash: '' };
  return {
    ...row,
    hash: recomputeHash(row),
    ...(overrides.hash === undefined ? {} : { hash: overrides.hash }),
  };
}

describe('audit event hashing', () => {
  it('accepts namespace.verb and domain.entity.verb actions only', () => {
    for (const ok of ['script.published', 'campaign.campaign.created', 'audit.siemDelivery.failed'])
      expect(AUDIT_ACTION.test(ok)).toBe(true);
    for (const bad of [
      'script',
      'Script.published',
      'a.b.c.d',
      'script.pub-lished',
      'script..x',
      '',
    ])
      expect(AUDIT_ACTION.test(bad)).toBe(false);
  });

  it('round-trips: rebuilding the event from the stored row gives the same hash', () => {
    const row = storedRow();
    expect(hashEventV2(rowToEvent(row))).toBe(row.hash);
    expect(row.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is independent of JSON key order (JSONB reorders keys)', () => {
    const a = storedRow({ metadata: { a: 1, b: { y: 2, x: 1 } } });
    const b = storedRow({ metadata: { b: { x: 1, y: 2 }, a: 1 } });
    expect(a.hash).toBe(b.hash);
  });

  const MUTATIONS: [string, Partial<StoredAuditRow>][] = [
    ['id', { id: '01J0000000000000000000000B' }],
    ['tenantId', { tenantId: '0199a000-0000-7000-8000-000000000002' }],
    ['seq', { seq: 2n }],
    ['action', { action: 'script.version.retired' }],
    ['actorType', { actorType: 'system' }],
    ['actorId', { actorId: 'u-2' }],
    ['actor detail', { actor: { ip: '10.0.0.2', sessionId: 's-1' } }],
    ['injected actor key', { actor: { ip: '10.0.0.1', sessionId: 's-1', role: 'admin' } }],
    ['resource type', { targetType: 'Script' }],
    ['resource id', { targetId: 'v-2' }],
    ['resource name', { targetName: null }],
    ['outcome', { outcome: 'denied' }],
    ['reason', { reason: 'x' }],
    ['diff', { diff: { mode: 'snapshot', before: null, after: null } }],
    ['correlationId', { correlationId: 'c-2' }],
    ['interactionId', { interactionId: 'i-1' }],
    ['metadata', { metadata: { a: 1 } }],
    ['occurredAt (1 ms)', { occurredAt: new Date('2026-10-01T10:00:00.124Z') }],
    ['recordedAt', { recordedAt: new Date('2026-10-01T10:00:00.126Z') }],
    ['prevHash', { prevHash: 'f'.repeat(64) }],
    ['hashVersion downgrade', { hashVersion: 1 }],
  ];

  it.each(MUTATIONS)('detects a change of %s', (_name, change) => {
    const original = storedRow();
    expect(recomputeHash({ ...original, ...change })).not.toBe(original.hash);
  });

  it('keeps prompt-3 (v1) rows verifiable', () => {
    const v1 = {
      tenantId: 't',
      seq: 1n,
      action: 'campaign.campaign.created',
      actorType: 'user',
      actorId: 'u',
      actor: { ip: '' },
      targetType: 'Campaign',
      targetId: 'c',
      targetName: null,
      outcome: 'success',
      diff: null,
      correlationId: 'k',
      occurredAt: '2026-10-01T00:00:00.000Z',
      prevHash: GENESIS_HASH,
    };
    const hash = hashEventV1(v1);
    const row = storedRow({
      ...v1,
      hashVersion: 1,
      occurredAt: new Date(v1.occurredAt),
      reason: null,
      interactionId: null,
      metadata: {},
    });
    expect(recomputeHash({ ...row, hash })).toBe(hash);
  });

  it('hashes v2 events built by the writer', () => {
    const event: ChainedAuditEvent = {
      ...rowToEvent(storedRow()),
    };
    expect(hashEventV2(event)).toBe(storedRow().hash);
  });
});
