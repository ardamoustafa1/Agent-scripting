import { generateKeyPairSync, randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { requestContext, systemContext } from '../../common/context/request-context.js';

import { AuditQueryService } from './audit-query.service.js';
import { checkpointPayload } from './checkpoints.js';
import { GENESIS_HASH, recomputeHash } from './core/audit-event.js';
import { CheckpointSigner } from './core/checkpoint-signer.js';

import type { AuditRepository } from './audit.repository.js';
import type { AuditService } from './audit.service.js';
import type { CheckpointRow } from './checkpoints.js';
import type { StoredAuditRow } from './core/audit-event.js';
import type { ApiEnv } from '../../env.js';
import type { TenantDb } from '../../infra/database/tenant-db.js';

function fixture(options: { signed?: boolean; empty?: boolean; maxRows?: number } = {}) {
  const tenantId = randomUUID();
  const rows: StoredAuditRow[] = [];
  for (let seq = 1n; seq <= 3n; seq++) {
    const row: StoredAuditRow = {
      id: randomUUID(),
      tenantId,
      seq,
      hashVersion: 2,
      action: 'synthetic.event.created',
      actorType: 'user',
      actorId: randomUUID(),
      actor: {},
      targetType: 'Script',
      targetId: randomUUID(),
      targetName: 'Synthetic',
      outcome: 'success',
      reason: null,
      diff: null,
      correlationId: randomUUID(),
      interactionId: null,
      metadata: {},
      occurredAt: new Date(),
      recordedAt: new Date(),
      prevHash: rows.at(-1)?.hash ?? GENESIS_HASH,
      hash: '',
    };
    rows.push({ ...row, hash: recomputeHash(row) });
  }
  const checkpoints: CheckpointRow[] = [];
  const signer = CheckpointSigner.fromJwk(
    JSON.stringify({
      ...generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' }),
      kid: 'synthetic',
    }),
  );
  const tx = {
    $queryRaw: vi
      .fn()
      .mockImplementation((_sql: unknown, _tenant: unknown, from: bigint, to: bigint) =>
        Promise.resolve(checkpoints.filter((row) => row.seq >= from && row.seq <= to)),
      ),
  };
  const repository = {
    head: vi.fn().mockResolvedValue(options.empty ? undefined : rows.at(-1)),
    minSeq: vi.fn().mockResolvedValue(options.empty ? undefined : 1n),
    search: vi.fn<AuditRepository['search']>().mockResolvedValue(options.empty ? [] : rows),
    range: vi.fn<AuditRepository['range']>().mockResolvedValue(options.empty ? [] : rows),
    findBySeq: vi.fn<AuditRepository['findBySeq']>().mockResolvedValue(undefined),
  };
  const audit = {
    record: vi
      .fn<(tx: unknown, event: Record<string, unknown>) => Promise<void>>()
      .mockResolvedValue(undefined),
  };
  const service = new AuditQueryService(
    {
      current: () => tx,
      tenantId: () => tenantId,
      run: (_tenant: string, work: (transaction: typeof tx) => Promise<unknown>) => work(tx),
    } as unknown as TenantDb,
    repository,
    audit as unknown as AuditService,
    {
      AUDIT_EXPORT_MAX_ROWS: options.maxRows ?? 100,
      AUDIT_VERIFY_MAX_ROWS: options.maxRows ?? 100,
    } as ApiEnv,
    options.signed ? signer : undefined,
  );
  const run = <T>(work: () => T) =>
    requestContext.run(systemContext(randomUUID(), 'synthetic-query'), work);
  const checkpoint = (row: StoredAuditRow): CheckpointRow => {
    const payload = {
      id: randomUUID(),
      tenantId,
      seq: row.seq,
      hash: row.hash,
      sessionHeadsDigest: GENESIS_HASH,
      sessionHeadsCount: 0,
      prevCheckpointId: null,
      signedAt: new Date(),
    };
    return { ...payload, keyId: signer.keyId, signature: signer.sign(checkpointPayload(payload)) };
  };
  return { service, rows, repository, audit, checkpoints, checkpoint, run };
}
async function collect(stream: AsyncGenerator<string>) {
  let text = '';
  for await (const chunk of stream) text += chunk;
  return text;
}

describe('audit query and cryptographic verification', () => {
  it('bounds search pages and audits bigint filters without leaking an extra row', async () => {
    const f = fixture();
    const result = await f.service.search(
      { fromSeq: 1n, toSeq: 3n },
      { limit: 2, direction: 'desc' },
    );
    expect(result).toEqual({ rows: f.rows.slice(0, 2), hasMore: true });
    expect(f.audit.record.mock.calls[0]?.[1]).toMatchObject({
      metadata: { filters: { fromSeq: '1', toSeq: '3' }, count: 2 },
    });
    f.repository.search.mockResolvedValue([]);
    expect((await f.service.search({}, { limit: 2, direction: 'asc' })).hasMore).toBe(false);
  });
  it.each(['json', 'csv'] as const)(
    'streams a bounded %s export after recording the audit',
    async (format) => {
      const f = fixture();
      const result = await f.run(() => f.service.export({ toSeq: 2n }, format));
      expect(f.audit.record).toHaveBeenCalledOnce();
      expect(f.repository.search).not.toHaveBeenCalled();
      const exported = await collect(result.stream);
      expect(result.snapshotSeq).toBe(3n);
      expect(f.repository.search.mock.calls[0]?.[2]).toMatchObject({ toSeq: 2n });
      if (format === 'json') expect(JSON.parse(exported)).toHaveLength(3);
      else {
        expect(exported).toContain('synthetic.event.created');
        expect(exported.split('\n').length).toBeGreaterThan(3);
      }
    },
  );
  it('exports an empty chain and skips reads when the configured row budget is zero', async () => {
    const f = fixture({ empty: true });
    const result = await f.run(() => f.service.export({}, 'json'));
    expect(result.snapshotSeq).toBe(0n);
    expect(await collect(result.stream)).toBe('[]');
    const bounded = fixture({ maxRows: 0 });
    expect(
      await collect((await bounded.run(() => bounded.service.export({}, 'json'))).stream),
    ).toBe('[]');
    expect(bounded.repository.search).not.toHaveBeenCalled();
  });
  it('verifies genesis chains and reports an empty chain without invented head metadata', async () => {
    const f = fixture();
    expect(await f.run(() => f.service.verify({}))).toMatchObject({
      valid: true,
      checked: 3,
      signaturesVerified: false,
      headSeq: '3',
    });
    const empty = fixture({ empty: true });
    expect(await empty.run(() => empty.service.verify({}))).toMatchObject({
      valid: true,
      checked: 0,
      headSeq: null,
    });
  });
  it.each([
    'valid event',
    'tampered event',
    'checkpoint mismatch',
    'signed archived anchor',
    'unsigned archived anchor',
    'invalid signature',
    'missing anchor',
  ] as const)('checks partial-range anchors: %s', async (kind) => {
    const signed = kind === 'signed archived anchor' || kind === 'invalid signature';
    const f = fixture({ signed });
    const prior = f.rows[0]!;
    f.repository.range.mockResolvedValue(f.rows.slice(1));
    if (kind.includes('event') || kind === 'checkpoint mismatch')
      f.repository.findBySeq.mockResolvedValue(
        kind === 'tampered event' ? { ...prior, action: 'synthetic.event.tampered' } : prior,
      );
    if (
      kind.includes('archived') ||
      kind === 'checkpoint mismatch' ||
      kind === 'invalid signature'
    ) {
      const checkpoint = f.checkpoint(prior);
      f.checkpoints.push(
        kind === 'invalid signature'
          ? { ...checkpoint, signature: 'invalid' }
          : kind === 'checkpoint mismatch'
            ? { ...checkpoint, hash: 'f'.repeat(64) }
            : checkpoint,
      );
    }
    const report = await f.run(() => f.service.verify({ fromSeq: 2n, toSeq: 3n }));
    expect(report.valid).toBe(
      ['valid event', 'signed archived anchor', 'unsigned archived anchor'].includes(kind),
    );
    expect(report.signaturesVerified).toBe(signed);
    expect(f.audit.record.mock.calls[0]?.[1]['outcome']).toBe(report.valid ? 'success' : 'failure');
  });
  it('rejects tampered in-range checkpoint signatures and missing events', async () => {
    const f = fixture({ signed: true });
    f.checkpoints.push({ ...f.checkpoint(f.rows[1]!), signature: 'invalid' });
    expect((await f.run(() => f.service.verify({}))).valid).toBe(false);
    f.checkpoints.length = 0;
    f.repository.range.mockResolvedValue([]);
    expect((await f.run(() => f.service.verify({}))).valid).toBe(false);
  });
});
