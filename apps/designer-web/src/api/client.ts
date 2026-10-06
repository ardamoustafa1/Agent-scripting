import { z } from 'zod';

import { MePermissionsSchema } from '@verbis/authz';
import { retryAfterSeconds } from '@verbis/ui';

import type { components, paths } from './generated.js';

export type Campaign = components['schemas']['Campaign'];
export type Assignment = components['schemas']['Assignment'];
export type Script = components['schemas']['Script'];
export type CreateCampaign = components['schemas']['CreateCampaign'];
export type CreateScript = components['schemas']['CreateScript'];
export type ApiPaths = keyof paths;
export const SessionSchema = z.object({
  user: z.object({
    id: z.string(),
    tenantId: z.uuid(),
    authMethod: z.enum(['sso', 'break_glass']),
  }),
  session: z.object({ id: z.string(), expiresAt: z.string() }),
  csrfToken: z.string().min(1),
});
export type Session = z.infer<typeof SessionSchema>;
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryAfter?: number,
  ) {
    super(code);
  }
}
export async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  options: {
    signal?: AbortSignal;
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    ifMatch?: string;
    body?: unknown;
    csrf?: string;
    idempotencyKey?: string;
  } = {},
): Promise<T> {
  if (
    !/^\/(auth|v1)\//.test(path) ||
    path.includes('://') ||
    path.includes('..') ||
    /[\\#%]/.test(path.split('?')[0] ?? '')
  )
    throw new ApiError(400, 'VERBIS_CLIENT_PATH');
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    redirect: 'error',
    method: options.method ?? 'GET',
    ...(options.signal ? { signal: options.signal } : {}),
    headers: {
      accept: 'application/json',
      ...(options.ifMatch ? { 'if-match': options.ifMatch } : {}),
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.csrf ? { 'x-csrf-token': options.csrf } : {}),
      ...(options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const problem = z.object({ code: z.string() }).safeParse(body);
    throw new ApiError(
      response.status,
      problem.success ? problem.data.code : 'VERBIS_HTTP_UNAVAILABLE',
      response.status === 429 ? retryAfterSeconds(response.headers.get('retry-after')) : undefined,
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(502, 'VERBIS_RESPONSE_INVALID');
  return parsed.data;
}
export async function session(signal: AbortSignal): Promise<Session | null> {
  try {
    return await request('/auth/session', SessionSchema, { signal });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}
export const permissions = (signal: AbortSignal) =>
  request('/v1/me/permissions', MePermissionsSchema, { signal });
export const DiscoverySchema = z.object({
  tenant: z.string(),
  providers: z.array(
    z.object({ id: z.string(), displayName: z.string(), protocol: z.enum(['oidc', 'saml']) }),
  ),
});
export function loginUrl(tenant: string, provider: string): string {
  return `/api/auth/login?${new URLSearchParams({ tenant, idp: provider, app: 'designer', returnTo: '/' }).toString()}`;
}
export const ResourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  status: z.string().optional(),
  tags: z.array(z.string()).default([]),
  updatedAt: z.string().optional(),
  createdAt: z.string().optional(),
  ownerId: z.string().optional(),
  currentVersionId: z.string().nullable().optional(),
  key: z.string().optional(),
});
export type Resource = z.infer<typeof ResourceSchema>;
export const PageSchema = z.object({
  data: z.array(ResourceSchema),
  page: z.object({ nextCursor: z.string().nullable() }),
});
const ArraySchema = z.array(ResourceSchema);
export const resources = {
  campaigns: '/v1/campaigns',
  scripts: '/v1/scripts',
  screens: '/v1/shared-screens',
  integrations: '/v1/data-sources',
  templates: '/v1/templates',
} as const satisfies Record<string, ApiPaths>;
export type ResourceKind = keyof typeof resources;
export async function list(kind: ResourceKind, signal: AbortSignal, cursor?: string) {
  const query = new URLSearchParams();
  if (!['screens', 'templates'].includes(kind)) query.set('limit', '100');
  if (cursor) query.set('cursor', cursor);
  const body = await request(`${resources[kind]}${query.size ? `?${query}` : ''}`, z.unknown(), {
    signal,
  });
  if (kind === 'screens' || kind === 'templates') {
    const rows = z
      .array(z.record(z.string(), z.unknown()))
      .parse(body)
      .map((row) => ({
        ...row,
        name: row['name'] ?? row['key'],
        updatedAt: row['updatedAt'] ?? row['createdAt'],
      }));
    return { data: ArraySchema.parse(rows), page: { nextCursor: null } };
  }
  if (kind === 'integrations') {
    const page = z
      .object({
        data: z.array(z.record(z.string(), z.unknown())),
        page: z.object({ nextCursor: z.string().nullable() }),
      })
      .parse(body);
    return {
      ...page,
      data: page.data.map((row) =>
        ResourceSchema.parse({ ...row, name: row['name'] ?? row['key'] }),
      ),
    };
  }
  return PageSchema.parse(body);
}
export const CampaignSchema = ResourceSchema.extend({
  id: z.uuid(),
  version: z.number().int(),
  status: z.enum(['draft', 'active', 'paused', 'archived']),
  defaultLocale: z.string().default('tr'),
  locales: z.array(z.string()).default([]),
  queues: z.array(z.string()).default([]),
  outcomeSet: z
    .array(
      z.object({
        code: z.string(),
        label: z.string(),
        category: z.enum(['success', 'failure', 'callback', 'noContact', 'other']),
        requiresNote: z.boolean(),
        requiredFields: z.array(z.string()),
        subCodes: z.array(z.string()),
      }),
    )
    .default([]),
  channels: z.array(z.string()),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  externalMappings: z.array(
    z.object({ platform: z.string(), kind: z.string(), externalId: z.string() }),
  ),
});
export const AssignmentsSchema = z.object({
  data: z.array(
    z.object({
      id: z.uuid(),
      scriptId: z.uuid(),
      priority: z.number(),
      effectiveFrom: z.string().nullable(),
      effectiveTo: z.string().nullable(),
      variants: z.array(z.object({ key: z.string(), weight: z.number() })).nullable(),
    }),
  ),
  page: z.object({ nextCursor: z.string().nullable() }),
});
export const VersionsSchema = z.object({
  data: z.array(
    z.object({
      id: z.uuid(),
      number: z.number(),
      state: z.string(),
      createdAt: z.string(),
      createdBy: z.string().nullable().optional(),
    }),
  ),
  page: z.object({ nextCursor: z.string().nullable() }),
});
