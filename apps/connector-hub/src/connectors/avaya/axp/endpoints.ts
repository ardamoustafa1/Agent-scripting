import { z } from 'zod';

/**
 * Operator-level AXP endpoint configuration (audit M-25). The token realm path and the REST
 * wrap-up endpoint are NOT verified against an AXP tenant, so both are explicit configuration:
 * the token path is overridable and REST wrap-up is disabled unless `wrapUpMode: 'rest'`.
 * Hosts stay pinned to `*.avayacloud.com` (config.ts); only same-host paths are configurable.
 */
export const AXP_DEFAULT_TOKEN_PATH = '/auth/realms/{accountId}/protocol/openid-connect/token';

const PLACEHOLDERS = new Set(['accountId', 'interactionId']);

export const AxpPathTemplateSchema = z
  .string()
  .max(256)
  .regex(/^\/[A-Za-z0-9._~/{}-]*$/, 'must be an absolute path without query or host')
  .refine((path) => !path.includes('//') && !path.split('/').includes('..'), 'unsafe path')
  .refine(
    (path) =>
      [...path.matchAll(/\{([^}]*)\}/g)].every((m) => PLACEHOLDERS.has(m[1] ?? '')) &&
      !/[{}]/.test(path.replace(/\{[A-Za-z]+\}/g, '')),
    'only {accountId} and {interactionId} placeholders are allowed',
  );

export const AxpEndpointsSchema = z
  .strictObject({
    tokenPath: AxpPathTemplateSchema.default(AXP_DEFAULT_TOKEN_PATH),
    wrapUpMode: z.enum(['disabled', 'rest']).default('disabled'),
    wrapUpPath: AxpPathTemplateSchema.optional(),
  })
  .refine((e) => e.wrapUpMode !== 'rest' || e.wrapUpPath !== undefined, {
    message: 'wrapUpPath is required when wrapUpMode is rest',
    path: ['wrapUpPath'],
  });
export type AxpEndpoints = z.infer<typeof AxpEndpointsSchema>;

export function renderAxpPath(template: string, values: Record<string, string>): string {
  return template.replace(/\{([A-Za-z]+)\}/g, (_m, key: string) =>
    encodeURIComponent(values[key] ?? ''),
  );
}
