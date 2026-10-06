import { expect, it } from 'vitest';
import { z } from 'zod';
it('validates the public prop boundary', () => {
  const schema = z.strictObject({ value: z.string() });
  expect(schema.safeParse({ value: 'demo' }).success).toBe(true);
  expect(schema.safeParse({ value: 42 }).success).toBe(false);
});
