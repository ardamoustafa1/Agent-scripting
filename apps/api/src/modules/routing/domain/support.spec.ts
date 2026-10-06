import { describe, expect, it } from 'vitest';

import { bucketOf, pickVariant, VariantsSchema } from './ab.js';
import { detectConflicts } from './conflicts.js';
import { isOpen, localParts, WorkingHoursSchema } from './working-hours.js';

import type { CandidateAssignment } from './resolver.js';

const base = (id: string, o: Partial<CandidateAssignment> = {}): CandidateAssignment => ({
  id,
  scriptId: 's',
  scriptStatus: 'active',
  priority: 10,
  effectiveFrom: null,
  effectiveTo: null,
  conditions: {},
  expression: null,
  versionPolicy: 'latestPublished',
  pinnedVersionId: null,
  variants: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  ...o,
});

describe('working hours', () => {
  const hours = WorkingHoursSchema.parse({
    timezone: 'Europe/Istanbul',
    weekly: { mon: [{ from: '09:00', to: '18:00' }], sat: [{ from: '10:00', to: '14:00' }] },
    holidays: ['2026-10-29'],
  });

  it('evaluates in the campaign time zone', () => {
    expect(localParts(new Date('2026-10-05T05:59:00Z'), 'Europe/Istanbul')).toEqual({
      day: 'mon',
      date: '2026-10-05',
      time: '08:59',
    });
    expect(isOpen(hours, new Date('2026-10-05T05:59:00Z'))).toBe(false);
    expect(isOpen(hours, new Date('2026-10-05T06:00:00Z'))).toBe(true);
    expect(isOpen(hours, new Date('2026-10-05T15:00:00Z'))).toBe(false); // 18:00 exclusive
    expect(isOpen(hours, new Date('2026-10-06T08:00:00Z'))).toBe(false); // tuesday not configured
    expect(isOpen(hours, new Date('2026-10-10T08:00:00Z'))).toBe(true); // saturday 11:00
  });

  it('honours holidays and rejects invalid configuration', () => {
    // 2026-10-29 is a Thursday holiday; make Thursday open to prove the holiday wins.
    const thu = WorkingHoursSchema.parse({
      ...hours,
      weekly: { thu: [{ from: '00:00', to: '24:00' }] },
    });
    expect(isOpen(thu, new Date('2026-10-29T09:00:00Z'))).toBe(false);
    expect(isOpen(thu, new Date('2026-10-22T09:00:00Z'))).toBe(true);
    expect(WorkingHoursSchema.safeParse({ timezone: 'Mars/Olympus', weekly: {} }).success).toBe(
      false,
    );
    expect(
      WorkingHoursSchema.safeParse({
        timezone: 'UTC',
        weekly: { mon: [{ from: '18:00', to: '09:00' }] },
      }).success,
    ).toBe(false);
  });
});

describe('A/B buckets', () => {
  it('weights must sum to 10000 with unique keys', () => {
    expect(
      VariantsSchema.safeParse([
        { key: 'a', weight: 5000 },
        { key: 'b', weight: 5000 },
      ]).success,
    ).toBe(true);
    expect(
      VariantsSchema.safeParse([
        { key: 'a', weight: 5000 },
        { key: 'b', weight: 4000 },
      ]).success,
    ).toBe(false);
    expect(
      VariantsSchema.safeParse([
        { key: 'a', weight: 5000 },
        { key: 'a', weight: 5000 },
      ]).success,
    ).toBe(false);
  });

  it('buckets are stable, in range and independent per assignment', () => {
    expect(bucketOf('x', 'k')).toBe(bucketOf('x', 'k'));
    expect(bucketOf('x', 'k')).toBeGreaterThanOrEqual(0);
    expect(bucketOf('x', 'k')).toBeLessThan(10_000);
    const differs = Array.from(
      { length: 50 },
      (_v, i) => bucketOf('x', String(i)) !== bucketOf('y', String(i)),
    ).filter(Boolean).length;
    expect(differs).toBeGreaterThan(40);
  });

  it('picks by cumulative weight', () => {
    const v = [
      { key: 'a', weight: 2000 },
      { key: 'b', weight: 0 },
      { key: 'c', weight: 8000 },
    ];
    expect(pickVariant(v, 0)?.key).toBe('a');
    expect(pickVariant(v, 1999)?.key).toBe('a');
    expect(pickVariant(v, 2000)?.key).toBe('c');
    expect(pickVariant(v, 9999)?.key).toBe('c');
  });
});

describe('conflict detection', () => {
  it('flags equal priority with overlapping context as certain', () => {
    const conflicts = detectConflicts([base('a'), base('b')]);
    expect(conflicts).toEqual([
      expect.objectContaining({ assignmentIds: ['a', 'b'], severity: 'certain', resolvedBy: 'id' }),
    ]);
  });

  it.each([
    ['different priority', base('a'), base('b', { priority: 11 })],
    [
      'disjoint channels',
      base('a', { conditions: { channels: ['voice'] } }),
      base('b', { conditions: { channels: ['chat'] } }),
    ],
    [
      'disjoint queues',
      base('a', { conditions: { queues: ['q1'] } }),
      base('b', { conditions: { queues: ['q2'] } }),
    ],
    [
      'disjoint locales',
      base('a', { conditions: { locales: ['tr'] } }),
      base('b', { conditions: { locales: ['en'] } }),
    ],
    [
      'disjoint windows',
      base('a', { effectiveTo: new Date('2026-06-01T00:00:00Z') }),
      base('b', { effectiveFrom: new Date('2026-06-01T00:00:00Z') }),
    ],
    ['archived script', base('a', { scriptStatus: 'archived' }), base('b')],
  ])('no conflict: %s', (_n, a, b) => {
    expect(detectConflicts([a, b])).toEqual([]);
  });

  it('reports the overlap and how the resolver would break the tie', () => {
    const [conflict] = detectConflicts([
      base('a', { conditions: { channels: ['voice', 'chat'], locales: ['tr'] } }),
      base('b', {
        conditions: { channels: ['chat'], locales: ['tr-TR'] },
        expression: { fact: 'interaction.vip', op: 'eq', value: true },
      }),
    ]);
    expect(conflict).toMatchObject({
      severity: 'possible',
      resolvedBy: 'specificity',
      overlap: {
        channels: ['chat'],
        locales: ['tr'],
        queues: 'any',
        skills: 'any',
        segments: 'any',
      },
    });
    const [recency] = detectConflicts([
      base('a', { createdAt: new Date('2026-05-01T00:00:00Z') }),
      base('b'),
    ]);
    expect(recency?.resolvedBy).toBe('recency');
  });

  it('ignores expired assignments when a reference time is given', () => {
    expect(
      detectConflicts(
        [base('a', { effectiveTo: new Date('2026-01-02T00:00:00Z') }), base('b')],
        new Date('2026-03-01T00:00:00Z'),
      ),
    ).toEqual([]);
  });

  it('finds every pair among three', () => {
    expect(
      detectConflicts([base('a'), base('b'), base('c')]).map((c) => c.assignmentIds.join('+')),
    ).toEqual(['a+b', 'a+c', 'b+c']);
  });
});
