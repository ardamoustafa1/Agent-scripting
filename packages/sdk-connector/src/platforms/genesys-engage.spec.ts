import { describe, expect, it } from 'vitest';

import { AttachedDataMapSchema } from './genesys-engage.js';

describe('engage attached data map', () => {
  it('applies defaults and refuses duplicates or bad names', () => {
    expect(AttachedDataMapSchema.parse([{ key: 'Customer Id', variable: 'customer.id' }])).toEqual([
      { key: 'Customer Id', variable: 'customer.id', type: 'string', writeBack: false, pii: false },
    ]);
    expect(
      AttachedDataMapSchema.safeParse([
        { key: 'A', variable: 'v' },
        { key: 'A', variable: 'w' },
      ]).success,
    ).toBe(false);
    expect(AttachedDataMapSchema.safeParse([{ key: 'A', variable: 'has space' }]).success).toBe(
      false,
    );
    expect(AttachedDataMapSchema.safeParse([{ key: 'A<script>', variable: 'v' }]).success).toBe(
      false,
    );
  });
});
