import { HttpException } from '@nestjs/common';

import { problemForCode, problemForStatus, type ProblemDetails } from '@verbis/shared-types';

import { DomainError } from './domain-errors.js';

export interface ProblemResult {
  readonly problem: ProblemDetails;
  readonly headers: Readonly<Record<string, string>>;
  /** True for unexpected failures (logged at error level, details hidden). */
  readonly unexpected: boolean;
}

interface RequestInfo {
  readonly url: string;
  readonly correlationId: string;
}

/** PostgreSQL SQLSTATE anywhere in a (driver adapter) error chain. */
export function sqlStateOf(error: unknown, depth = 0): string | undefined {
  if (depth > 5 || typeof error !== 'object' || error === null) return undefined;
  const record = error as Record<string, unknown>;
  for (const key of ['originalCode', 'sqlState']) {
    const value = record[key];
    if (typeof value === 'string' && /^[0-9A-Z]{5}$/.test(value)) return value;
  }
  if (typeof record['code'] === 'string' && /^[0-9]{2}[0-9A-Z]{3}$/.test(record['code']))
    return record['code'];
  for (const key of ['cause', 'meta', 'driverAdapterError']) {
    const nested = sqlStateOf(record[key], depth + 1);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function prismaCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^P\d{4}$/.test(code) ? code : undefined;
}

const FASTIFY_CODES: Readonly<Record<string, Parameters<typeof problemForCode>[0]>> = {
  FST_ERR_CTP_BODY_TOO_LARGE: 'VERBIS_HTTP_PAYLOAD_TOO_LARGE',
  FST_ERR_CTP_INVALID_MEDIA_TYPE: 'VERBIS_HTTP_UNSUPPORTED_MEDIA_TYPE',
  FST_ERR_CTP_EMPTY_JSON_BODY: 'VERBIS_VALIDATION_FAILED',
  FST_ERR_CTP_INVALID_JSON_BODY: 'VERBIS_VALIDATION_FAILED',
};

/** HTTP statuses raised by Nest/Fastify internals that have a catalogued Verbis code. */
const HTTP_STATUS_CODES: Readonly<Record<number, Parameters<typeof problemForCode>[0]>> = {
  413: 'VERBIS_HTTP_PAYLOAD_TOO_LARGE',
  415: 'VERBIS_HTTP_UNSUPPORTED_MEDIA_TYPE',
  429: 'VERBIS_HTTP_RATE_LIMITED',
};

/** Maps any thrown value to an RFC 7807 problem (CLAUDE.md §7). Never leaks internals on 5xx. */
export function toProblem(error: unknown, request: RequestInfo): ProblemResult {
  const base = { instance: request.url.split('?')[0] ?? '/', correlationId: request.correlationId };

  if (error instanceof DomainError) {
    return {
      problem: problemForCode(error.code, {
        ...base,
        ...(error.detail === undefined ? {} : { detail: error.detail }),
        ...(error.errors === undefined ? {} : { errors: error.errors }),
      }),
      headers: error.headers ?? {},
      unexpected: false,
    };
  }

  if (error instanceof HttpException) {
    const status = error.getStatus();
    const catalogued = HTTP_STATUS_CODES[status];
    if (catalogued !== undefined)
      return { problem: problemForCode(catalogued, base), headers: {}, unexpected: false };
    return {
      problem: problemForStatus(status, {
        ...base,
        ...(status < 500 ? { detail: error.message.replace(/\?\S*/g, '') } : {}),
      }),
      headers: {},
      unexpected: status >= 500,
    };
  }

  const fastifyCode =
    typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  if (typeof fastifyCode === 'string' && fastifyCode in FASTIFY_CODES) {
    const code = FASTIFY_CODES[fastifyCode];
    if (code !== undefined)
      return { problem: problemForCode(code, base), headers: {}, unexpected: false };
  }
  const statusCode =
    typeof error === 'object' && error !== null
      ? (error as { statusCode?: unknown }).statusCode
      : undefined;
  if (statusCode === 429) {
    return {
      problem: problemForCode('VERBIS_HTTP_RATE_LIMITED', base),
      headers: {},
      unexpected: false,
    };
  }

  const prisma = prismaCode(error);
  if (prisma === 'P2002') {
    return {
      problem: problemForCode('VERBIS_RESOURCE_CONFLICT', {
        ...base,
        detail: 'A resource with the same unique key already exists',
      }),
      headers: {},
      unexpected: false,
    };
  }
  if (prisma === 'P2025') {
    return {
      problem: problemForCode('VERBIS_RESOURCE_NOT_FOUND', base),
      headers: {},
      unexpected: false,
    };
  }
  const sqlState = sqlStateOf(error);
  if (sqlState === '23505') {
    return {
      problem: problemForCode('VERBIS_RESOURCE_CONFLICT', base),
      headers: {},
      unexpected: false,
    };
  }
  if (sqlState === '42501') {
    // Row-level security or privilege violation: a bug or an attack. Deny without detail.
    return {
      problem: problemForCode('VERBIS_AUTHZ_FORBIDDEN', base),
      headers: {},
      unexpected: true,
    };
  }

  if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
    return { problem: problemForStatus(statusCode, base), headers: {}, unexpected: false };
  }
  return { problem: problemForStatus(500, base), headers: {}, unexpected: true };
}
