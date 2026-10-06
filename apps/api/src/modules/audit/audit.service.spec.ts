import { describe, expect, it, vi } from 'vitest';

import { requestContext, type RequestContext } from '../../common/context/request-context.js';
import { createUlidFactory } from '../../common/ids/ulid.js';

import { AuditService, principalActorType } from './audit.service.js';
import { GENESIS_HASH, recomputeHash, type StoredAuditRow } from './core/audit-event.js';

import type { TransactionClient } from '../../infra/database/prisma.service.js';

const TENANT = '0199a000-0000-7000-8000-000000000001';

/** In-memory stand-in for the two statements the writer issues (head lock, unnest insert). */
function fakeDb() {
  const heads = new Map<string, { seq: bigint; hash: string; recorded_at: Date }>();
  const rows: StoredAuditRow[] = [];
  const statements: string[] = [];
  const sql = (strings: TemplateStringsArray) => strings.join('?').replace(/\s+/g, ' ').trim();
  const tx = {
    $executeRaw: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = sql(strings);
      statements.push(text);
      if (text.startsWith('INSERT INTO audit_chain_heads')) {
        const tenant = values[0] as string;
        if (!heads.has(tenant))
          heads.set(tenant, { seq: 0n, hash: values[1] as string, recorded_at: new Date(0) });
      } else if (text.startsWith('UPDATE audit_chain_heads')) {
        heads.set(values[3] as string, {
          seq: values[0] as bigint,
          hash: values[1] as string,
          recorded_at: new Date(values[2] as string),
        });
      } else if (text.startsWith('INSERT INTO audit_events')) {
        const [
          tenantId,
          ids,
          seqs,
          actions,
          actorTypes,
          actorIds,
          actors,
          types,
          targetIds,
          names,
          outcomes,
          reasons,
          diffs,
          correlations,
          interactions,
          metadata,
          occurred,
          recorded,
          prevs,
          hashes,
        ] = values as [
          string,
          ...[
            unknown[],
            unknown[],
            unknown[],
            unknown[],
            unknown[],
            unknown[],
            unknown[],
            unknown[],
            unknown[],
            unknown[],
            unknown[],
            unknown[],
            unknown[],
            unknown[],
            unknown[],
            unknown[],
            unknown[],
            unknown[],
            unknown[],
          ],
        ];
        ids.forEach((id, i) => {
          rows.push({
            id: id as string,
            tenantId,
            seq: BigInt(seqs[i] as string),
            hashVersion: 2,
            action: actions[i] as string,
            actorType: actorTypes[i] as string,
            actorId: actorIds[i] as string,
            actor: JSON.parse(actors[i] as string) as unknown,
            targetType: types[i] as string,
            targetId: targetIds[i] as string,
            targetName: names[i] as string | null,
            outcome: outcomes[i] as string,
            reason: reasons[i] as string | null,
            diff: diffs[i] === null ? null : (JSON.parse(diffs[i] as string) as unknown),
            correlationId: correlations[i] as string,
            interactionId: interactions[i] as string | null,
            metadata: JSON.parse(metadata[i] as string) as unknown,
            occurredAt: new Date(occurred[i] as string),
            recordedAt: new Date(recorded[i] as string),
            prevHash: prevs[i] as string,
            hash: hashes[i] as string,
          });
        });
      }
      return Promise.resolve(1);
    }),
    $queryRaw: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      statements.push(sql(strings));
      const head = heads.get(values[0] as string);
      return Promise.resolve(head === undefined ? [] : [head]);
    }),
  };
  return { tx: tx as unknown as TransactionClient, rows, heads, statements };
}

function context(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: 'r',
    correlationId: 'corr-1',
    ip: '203.0.113.7',
    userAgent: 'jest',
    principal: { type: 'user', id: 'u-1', tenantId: TENANT, scopes: [], sessionId: 'sess' },
    ...overrides,
  };
}

function service(now = () => new Date('2026-10-01T10:00:00.000Z')) {
  const outbox = { record: vi.fn(() => Promise.resolve('o')) };
  const ids = createUlidFactory(
    () => now().getTime(),
    (n) => new Uint8Array(n),
  );
  return { audit: new AuditService(outbox, now, ids), outbox };
}

describe('AuditService (writer)', () => {
  it('chains events per tenant: seq from 1, prevHash links, hashes recompute from stored rows', async () => {
    const db = fakeDb();
    const { audit, outbox } = service();
    await requestContext.run(context(), async () => {
      await audit.record(db.tx, {
        action: 'campaign.campaign.created',
        target: { type: 'Campaign', id: 'c1' },
        after: { name: 'A', email: 'x@y' },
      });
      await audit.record(db.tx, {
        action: 'script.published',
        target: { type: 'Script', id: 's1' },
        reason: 'go',
      });
    });
    expect(db.rows.map((r) => r.seq)).toEqual([1n, 2n]);
    expect(db.rows[0]?.prevHash).toBe(GENESIS_HASH);
    expect(db.rows[1]?.prevHash).toBe(db.rows[0]?.hash);
    for (const row of db.rows) expect(recomputeHash(row)).toBe(row.hash);
    expect(db.heads.get(TENANT)).toMatchObject({ seq: 2n, hash: db.rows[1]?.hash });
    expect(db.rows[0]).toMatchObject({
      actorType: 'user',
      actorId: 'u-1',
      actor: { ip: '203.0.113.7', userAgent: 'jest', sessionId: 'sess' },
      correlationId: 'corr-1',
      diff: { mode: 'snapshot', before: null, after: { name: 'A', email: '[REDACTED]' } },
    });
    expect(outbox.record).toHaveBeenCalledTimes(2);
  });

  it('locks the chain head (FOR UPDATE) before inserting', async () => {
    const db = fakeDb();
    const { audit } = service();
    await requestContext.run(context(), () =>
      audit.record(db.tx, { action: 'a.b', target: { type: 'X', id: '1' } }),
    );
    const order = db.statements.map((s) => s.split(' ').slice(0, 3).join(' '));
    expect(order).toEqual([
      'INSERT INTO audit_chain_heads',
      'SELECT seq, hash,',
      'INSERT INTO audit_events',
      'UPDATE audit_chain_heads SET',
    ]);
    expect(db.statements[1]).toContain('FOR UPDATE');
  });

  it('writes a batch with one insert and keeps recorded_at monotonic', async () => {
    const db = fakeDb();
    let t = Date.parse('2026-10-01T10:00:00.000Z');
    const { audit } = service(() => new Date(t));
    await requestContext.run(context(), () =>
      audit.recordMany(
        db.tx,
        Array.from({ length: 100 }, (_v, i) => ({
          action: 'x.y',
          target: { type: 'T', id: String(i) },
        })),
      ),
    );
    t -= 60_000; // clock steps back
    await requestContext.run(context(), () =>
      audit.record(db.tx, { action: 'x.z', target: { type: 'T', id: 'late' } }),
    );
    expect(db.statements.filter((s) => s.startsWith('INSERT INTO audit_events'))).toHaveLength(2);
    expect(db.rows).toHaveLength(101);
    expect(db.rows[100]!.recordedAt.getTime()).toBeGreaterThanOrEqual(
      db.rows[99]!.recordedAt.getTime(),
    );
    expect(new Set(db.rows.map((r) => r.id)).size).toBe(101);
  });

  it('records system/connector events with an explicit actor and tenant', async () => {
    const db = fakeDb();
    const { audit, outbox } = service();
    await requestContext.run({ requestId: 'r', correlationId: 'k', ip: '', userAgent: '' }, () =>
      audit.recordMany(
        db.tx,
        [
          {
            action: 'connector.event.received',
            target: { type: 'Interaction', id: 'i' },
            actor: { type: 'connector', id: 'genesys' },
            interactionId: 'i',
          },
        ],
        { tenantId: TENANT },
      ),
    );
    expect(db.rows[0]).toMatchObject({
      actorType: 'connector',
      actorId: 'genesys',
      interactionId: 'i',
      tenantId: TENANT,
    });
    expect(outbox.record).not.toHaveBeenCalled();
  });

  it.each([
    [
      'invalid action',
      { action: 'Bad Action', target: { type: 'X', id: '1' } },
      /Invalid audit action/,
    ],
    [
      'oversized reason',
      { action: 'a.b', target: { type: 'X', id: '1' }, reason: 'x'.repeat(2000) },
      /reason exceeds/,
    ],
    [
      'oversized metadata',
      { action: 'a.b', target: { type: 'X', id: '1' }, metadata: { blob: 'x'.repeat(300_000) } },
      /metadata exceeds/,
    ],
  ])('rejects %s before touching the chain', async (_n, input, error) => {
    const db = fakeDb();
    const { audit } = service();
    await expect(requestContext.run(context(), () => audit.record(db.tx, input))).rejects.toThrow(
      error,
    );
    expect(db.statements).toHaveLength(0);
  });

  it('refuses events for another tenant and events without an actor', async () => {
    const db = fakeDb();
    const { audit } = service();
    await expect(
      requestContext.run(context(), () =>
        audit.recordMany(db.tx, [{ action: 'a.b', target: { type: 'X', id: '1' } }], {
          tenantId: '0199a000-0000-7000-8000-00000000000f',
        }),
      ),
    ).rejects.toThrow(/another tenant/);
    await expect(
      requestContext.run({ requestId: 'r', correlationId: 'k', ip: '', userAgent: '' }, () =>
        audit.recordMany(db.tx, [{ action: 'a.b', target: { type: 'X', id: '1' } }], {
          tenantId: TENANT,
        }),
      ),
    ).rejects.toThrow(/actor/);
  });

  it('sanitizes NUL characters so the stored row hashes the same', async () => {
    const db = fakeDb();
    const { audit } = service();
    await requestContext.run(context(), () =>
      audit.record(db.tx, {
        action: 'a.b',
        target: { type: 'X', id: 'a\u0000b' },
        metadata: { k: 'v\u0000' },
      }),
    );
    expect(db.rows[0]?.targetId).toBe('a�b');
    expect(recomputeHash(db.rows[0]!)).toBe(db.rows[0]?.hash);
  });

  it('counts recorded events on the request context', async () => {
    const db = fakeDb();
    const { audit } = service();
    const ctx = context();
    await requestContext.run(ctx, () =>
      audit.recordMany(db.tx, [
        { action: 'a.b', target: { type: 'X', id: '1' } },
        { action: 'a.c', target: { type: 'X', id: '2' } },
      ]),
    );
    expect(ctx.auditRecorded).toBe(2);
  });

  it('maps service principals to apiClient', () => {
    expect(principalActorType({ type: 'service', id: 's', tenantId: TENANT, scopes: [] })).toBe(
      'apiClient',
    );
  });
});
