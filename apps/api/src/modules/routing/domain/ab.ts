import { createHash } from 'node:crypto';

import { z } from 'zod';

/** Weights are basis points and must sum to exactly 10000 (100%). */
export const VariantSchema = z.strictObject({
  key: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  weight: z.number().int().min(0).max(10_000),
  /** Optional version override for this arm; otherwise the assignment's version policy. */
  pinnedVersionId: z.uuid().optional(),
});
export const VariantsSchema = z
  .array(VariantSchema)
  .min(2)
  .max(10)
  .refine(
    (v) => v.reduce((sum, x) => sum + x.weight, 0) === 10_000,
    'variant weights must sum to 10000',
  )
  .refine((v) => new Set(v.map((x) => x.key)).size === v.length, 'variant keys must be unique')
  .meta({ id: 'AbVariants' });
export type Variant = z.infer<typeof VariantSchema>;

/** Deterministic bucket 0..9999 from (assignment, sticky key): same caller → same arm. */
export function bucketOf(assignmentId: string, stickyKey: string): number {
  return (
    Number.parseInt(
      createHash('sha256').update(`${assignmentId}:${stickyKey}`).digest('hex').slice(0, 8),
      16,
    ) % 10_000
  );
}

export function pickVariant(variants: readonly Variant[], bucket: number): Variant | undefined {
  let upper = 0;
  for (const variant of variants) {
    upper += variant.weight;
    if (bucket < upper) return variant;
  }
  return undefined;
}
