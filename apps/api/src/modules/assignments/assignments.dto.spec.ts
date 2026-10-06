import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  BatchAssignmentsSchema,
  conditionsOf,
  CreateAssignmentSchema,
  UpdateAssignmentSchema,
  variantsOf,
} from './assignments.dto.js';

const ids = { scriptId: randomUUID(), campaignId: randomUUID() };
describe('assignment authoring validation', () => {
  it.each([null, undefined, false, 1, 'invalid', []])(
    'returns validation failure for invalid request bodies (%j)',
    (input) => {
      expect(CreateAssignmentSchema.safeParse(input).success).toBe(false);
      expect(UpdateAssignmentSchema.safeParse(input).success).toBe(false);
    },
  );
  it('accepts legacy window aliases while preserving explicitly supplied modern fields', () => {
    const from = '2026-10-01T00:00:00Z',
      to = '2026-10-05T00:00:00Z';
    expect(
      CreateAssignmentSchema.parse({ ...ids, validFrom: from, validTo: to, rule: null }),
    ).toMatchObject({ effectiveFrom: from, effectiveTo: to, expression: null });
    expect(
      CreateAssignmentSchema.parse({
        ...ids,
        validFrom: from,
        effectiveFrom: null,
        validTo: to,
        effectiveTo: null,
        rule: {},
        expression: null,
      }),
    ).toMatchObject({ effectiveFrom: null, effectiveTo: null, expression: null });
    expect(UpdateAssignmentSchema.parse({ validFrom: from, validTo: to, rule: null })).toEqual({
      effectiveFrom: from,
      effectiveTo: to,
      expression: null,
    });
  });
  it.each([
    { versionPolicy: 'pinned' },
    { versionPolicy: 'pinned', pinnedVersionId: null },
    { versionPolicy: 'latestPublished', pinnedVersionId: randomUUID() },
    { effectiveFrom: '2026-10-05T00:00:00Z', effectiveTo: '2026-10-01T00:00:00Z' },
    { effectiveFrom: '2026-10-01T00:00:00Z', effectiveTo: '2026-10-01T00:00:00Z' },
  ])('rejects inconsistent pins or inverted effective windows (%j)', (patch) => {
    expect(CreateAssignmentSchema.safeParse({ ...ids, ...patch }).success).toBe(false);
  });
  it('infers a legacy pin but accepts nullable or open-ended published windows', () => {
    const pinnedVersionId = randomUUID();
    expect(CreateAssignmentSchema.parse({ ...ids, pinnedVersionId }).versionPolicy).toBe('pinned');
    for (const window of [
      { effectiveFrom: null },
      { effectiveFrom: '2026-10-01T00:00:00Z' },
      { effectiveFrom: '2026-10-01T00:00:00Z', effectiveTo: null },
      { effectiveTo: '2026-10-01T00:00:00Z' },
    ])
      expect(CreateAssignmentSchema.safeParse({ ...ids, ...window }).success).toBe(true);
  });
  it.each(['channels', 'locales', 'queues', 'skills', 'segments'] as const)(
    'rejects duplicate %s conditions and fails legacy malformed filters closed',
    (key) => {
      const value = key === 'channels' ? 'voice' : key === 'locales' ? 'tr' : 'synthetic';
      expect(
        CreateAssignmentSchema.safeParse({ ...ids, conditions: { [key]: [value, value] } }).success,
      ).toBe(false);
      expect(conditionsOf({ [key]: [value, value] })).toEqual({});
      expect(conditionsOf({ [key]: [value] })).toEqual({ [key]: [value] });
    },
  );
  it('normalizes missing legacy conditions and validates variant weights before exposing them', () => {
    expect(conditionsOf(null)).toEqual({});
    expect(conditionsOf({ queues: undefined })).toEqual({});
    expect(variantsOf(null)).toBeNull();
    expect(variantsOf(undefined)).toBeNull();
    expect(variantsOf([{ key: 'A', weight: -1 }])).toBeNull();
    const variants = [
      { key: 'a', weight: 5000 },
      { key: 'b', weight: 5000 },
    ];
    expect(variantsOf(variants)).toEqual(variants);
  });
  it('rejects empty batches and duplicate update ids while allowing mixed operations', () => {
    const id = randomUUID(),
      update = { id, version: 1, patch: { priority: 1 } };
    expect(BatchAssignmentsSchema.safeParse({}).success).toBe(false);
    expect(BatchAssignmentsSchema.safeParse({ updates: [update, update] }).success).toBe(false);
    expect(BatchAssignmentsSchema.safeParse({ creates: [ids], updates: [update] }).success).toBe(
      true,
    );
  });
});

describe('routing expression admission', () => {
  it.each([
    { $expr: 'interaction.vip' },
    { not: { $expr: 'true' } },
    { any: [{ fact: 'interaction.vip', op: 'eq', value: true }, { $expr: 'false' }] },
  ])('rejects unsupported expressions in create, patch and legacy aliases (%j)', (expression) => {
    expect(CreateAssignmentSchema.safeParse({ ...ids, expression }).success).toBe(false);
    expect(UpdateAssignmentSchema.safeParse({ expression }).success).toBe(false);
    expect(UpdateAssignmentSchema.safeParse({ rule: expression }).success).toBe(false);
  });
  it.each(['[', '(a)\\1', '(?=a)a', 'x'.repeat(201)])(
    'rejects non-RE2 routing patterns at admission (%s)',
    (value) => {
      const expression = { fact: 'interaction.name', op: 'matches', value };
      expect(CreateAssignmentSchema.safeParse({ ...ids, expression }).success).toBe(false);
      expect(UpdateAssignmentSchema.safeParse({ expression }).success).toBe(false);
    },
  );
});
