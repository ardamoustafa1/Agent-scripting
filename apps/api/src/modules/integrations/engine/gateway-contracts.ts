import { z } from 'zod';

const name = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const GatewayCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('http'),
    url: z.url().max(4096),
    method: z.enum(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']),
    headers: z.record(z.string().max(128), z.string().max(8192)),
    body: z
      .string()
      .max(1024 * 1024)
      .optional(),
  }),
  z.strictObject({
    kind: z.literal('sql'),
    queryKey: name,
    parameters: z
      .array(z.union([z.string().max(8192), z.number(), z.boolean(), z.null()]))
      .max(100),
  }),
]);
export const GatewayJobSchema = z.strictObject({
  id: z.uuid(),
  lease: z.string().regex(/^[a-f0-9]{64}$/),
  target: name,
  deadline: z.number().int(),
  maxResponseBytes: z
    .number()
    .int()
    .min(1)
    .max(5 * 1024 * 1024),
  command: GatewayCommandSchema,
});
export const GatewayCompletionSchema = z.strictObject({
  lease: z.string().regex(/^[a-f0-9]{64}$/),
  response: z.strictObject({
    status: z.number().int().min(200).max(599),
    body: z.string().max(5 * 1024 * 1024),
  }),
});
export type GatewayJob = z.infer<typeof GatewayJobSchema>;
export type GatewayCommand = z.infer<typeof GatewayCommandSchema>;
export type GatewayCompletion = z.infer<typeof GatewayCompletionSchema>;
