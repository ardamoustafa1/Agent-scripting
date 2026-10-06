import { z } from 'zod';

export const RegressionReportSchema = z.strictObject({
  checksum: z.string(),
  version: z.number().int(),
  passed: z.boolean(),
  checkedAt: z.iso.datetime(),
  results: z.array(
    z.strictObject({
      id: z.string(),
      passed: z.boolean(),
      durationMs: z.number().nonnegative(),
      assertions: z.array(z.strictObject({ path: z.string(), passed: z.boolean() })),
      code: z.string().optional(),
    }),
  ),
});
export const PreviewLiveCallSchema = z.strictObject({
  input: z.record(z.string(), z.json()),
  environment: z.literal('test'),
});
export const PreviewLiveResultSchema = z.strictObject({
  value: z.json(),
  durationMs: z.number().nonnegative(),
});
