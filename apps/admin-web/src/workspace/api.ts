import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import { z } from 'zod';

import { type AuthSession } from '../auth/auth-api.js';

export const RowSchema = z.looseObject({ id: z.string(), version: z.number().optional() });
export type Row = z.infer<typeof RowSchema>;
export const RecordSchema = z.record(z.string(), z.unknown());
export const PageSchema = z.object({
  data: z.array(RowSchema),
  page: z.looseObject({ nextCursor: z.string().nullable().optional() }).optional(),
});
export const ListSchema = z
  .union([z.array(RowSchema), PageSchema])
  .transform((value) => (Array.isArray(value) ? { data: value, page: undefined } : value));
export const AdminContext = createContext<AuthSession | null>(null);
export function useAdmin() {
  const value = useContext(AdminContext);
  if (!value) throw new Error('Authenticated workspace required');
  return value;
}
export class AdminApiError extends Error {
  constructor(
    readonly code: string,
    readonly correlationId?: string,
    readonly status?: number,
  ) {
    super(code);
  }
}
export type ProblemCategory =
  | 'validation'
  | 'unauthenticated'
  | 'forbidden'
  | 'notFound'
  | 'conflict'
  | 'rateLimited'
  | 'unavailable'
  | 'unexpectedResponse'
  | 'generic';
/** Maps any thrown value to a user-facing category; machine codes are never shown (T-04). */
export function problemCategory(error: unknown): ProblemCategory {
  if (error instanceof z.ZodError) return 'unexpectedResponse';
  if (error instanceof TypeError) return 'unavailable';
  const code =
      error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : '',
    status = error instanceof AdminApiError ? error.status : undefined;
  if (code === 'VERBIS_HTTP_RATE_LIMITED') return 'rateLimited';
  if (code === 'VERBIS_HTTP_UNAVAILABLE') return 'unavailable';
  if (code === 'VERBIS_UNAUTHENTICATED') return 'unauthenticated';
  if (code.endsWith('_NOT_FOUND')) return 'notFound';
  if (code === 'VERBIS_CONFLICT' || code === 'VERBIS_PRECONDITION_FAILED') return 'conflict';
  if (code === 'VERBIS_VALIDATION_FAILED' || status === 400 || status === 422) return 'validation';
  if (status === 401) return 'unauthenticated';
  if (status === 403 || code.startsWith('VERBIS_AUTHZ_')) return 'forbidden';
  if (status === 404) return 'notFound';
  if (status === 409 || status === 412) return 'conflict';
  if (status === 429) return 'rateLimited';
  if (status !== undefined && status >= 500) return 'unavailable';
  return 'generic';
}
export async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
    csrf?: string;
    version?: number;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    ...(options.signal ? { signal: options.signal } : {}),
    headers: {
      accept: 'application/json',
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.csrf ? { 'x-csrf-token': options.csrf } : {}),
      ...(options.version === undefined ? {} : { 'if-match': `"${options.version}"` }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  if (!response.ok && path === '/health/ready' && response.status === 503)
    return schema.parse(await response.json());
  if (!response.ok) {
    const problem = z
      .object({ code: z.string(), correlationId: z.string().optional() })
      .safeParse(await response.json().catch(() => null));
    throw new AdminApiError(
      problem.success ? problem.data.code : `HTTP_${response.status}`,
      problem.success ? problem.data.correlationId : undefined,
      response.status,
    );
  }
  const value: unknown = response.status === 204 ? null : await response.json();
  return schema.parse(value);
}
export function useResource<T>(path: string, schema: z.ZodType<T>, poll = false) {
  const session = useAdmin();
  return useQuery({
    queryKey: ['admin', session.user.tenantId, session.user.id, path],
    queryFn: ({ signal }) => request(path, schema, { signal }),
    refetchInterval: poll ? 10000 : false,
    retry: false,
  });
}
export function useWrite() {
  const session = useAdmin(),
    client = useQueryClient();
  return async (
    path: string,
    body: unknown,
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'POST',
    version?: number,
  ) => {
    const result = await request(path, z.unknown(), {
      method,
      body,
      csrf: session.csrfToken,
      ...(version === undefined ? {} : { version }),
    });
    await client.invalidateQueries({ queryKey: ['admin', session.user.tenantId, session.user.id] });
    return result;
  };
}
export function text(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
export function record(value: unknown) {
  return RecordSchema.parse(value ?? {});
}
export function csv(value: string) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
export function json(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new AdminApiError('VERBIS_VALIDATION_FAILED');
  }
}
export async function download(path: string, filename: string) {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new AdminApiError(`HTTP_${response.status}`, undefined, response.status);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}
