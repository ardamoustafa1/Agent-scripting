import { describe, expect, it } from 'vitest';

import { buildTrustCenter, CHECKPOINT_STALE_HOURS, TrustCenterSchema } from './trust-center.js';

const now = new Date('2026-10-07T12:00:00Z');
const chain = {
  valid: true,
  checked: 120,
  headSeq: '120',
  breaks: 0,
  truncated: false,
  signaturesVerified: true,
  checkpointsChecked: 3,
};
const base = {
  now,
  windowDays: 30,
  chain,
  checkpoint: { seq: '110', signedAt: new Date('2026-10-07T06:00:00Z') },
  actionCounts: new Map<string, number>(),
  privacy: { open: 0, processed: 0, oldestOpenAt: null },
};

describe('buildTrustCenter', () => {
  it('is healthy only with a valid, signed, complete chain and a fresh checkpoint', () => {
    const result = buildTrustCenter(base);
    expect(result.chain.status).toBe('healthy');
    expect(result.chain.checkpointAgeHours).toBe(6);
    expect(TrustCenterSchema.safeParse(result).success).toBe(true);
  });
  it.each([
    ['unsigned', { ...base, chain: { ...chain, signaturesVerified: false } }],
    ['truncated', { ...base, chain: { ...chain, truncated: true } }],
    ['no checkpoint', { ...base, checkpoint: null }],
    [
      'stale checkpoint',
      {
        ...base,
        checkpoint: {
          seq: '1',
          signedAt: new Date(now.getTime() - (CHECKPOINT_STALE_HOURS + 1) * 3_600_000),
        },
      },
    ],
  ])('downgrades to attention when %s', (_name, input) => {
    expect(buildTrustCenter(input).chain.status).toBe('attention');
  });
  it('reports broken whenever verification found a break, even with fresh checkpoints', () => {
    const result = buildTrustCenter({ ...base, chain: { ...chain, valid: false, breaks: 2 } });
    expect(result.chain).toMatchObject({ status: 'broken', breaks: 2 });
  });
  it('maps audited actions to counters and never invents counts', () => {
    const result = buildTrustCenter({
      ...base,
      actionCounts: new Map([
        ['launch.attempt.denied', 4],
        ['launch.anomaly.detected', 1],
        ['audit.export.created', 2],
        ['secret.metadata.viewed', 7],
      ]),
      privacy: { open: 2, processed: 5, oldestOpenAt: new Date('2026-09-01T00:00:00Z') },
    });
    expect(result.launch).toEqual({
      issued: 0,
      redeemed: 0,
      denied: 4,
      anomalies: 1,
      urlParamsRejected: 0,
    });
    expect(result.sensitiveAccess.auditExports).toBe(2);
    expect(result.sensitiveAccess.secretMetadataViews).toBe(7);
    expect(result.sensitiveAccess.privacyExports).toBe(0);
    expect(result.privacy).toEqual({
      open: 2,
      processed: 5,
      oldestOpenAt: '2026-09-01T00:00:00.000Z',
    });
  });
  it('clamps a checkpoint timestamp in the future to age 0', () => {
    const result = buildTrustCenter({
      ...base,
      checkpoint: { seq: '1', signedAt: new Date(now.getTime() + 60_000) },
    });
    expect(result.chain.checkpointAgeHours).toBe(0);
  });
});
