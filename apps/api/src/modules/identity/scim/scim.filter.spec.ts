import { HttpException, Logger, type ArgumentsHost } from '@nestjs/common';
import { afterEach, expect, it, vi } from 'vitest';

import { DomainError, ValidationError } from '../../../common/errors/domain-errors.js';

import { SCIM_CONTENT_TYPE, SCIM_ERROR_SCHEMA, ScimError } from './scim.errors.js';
import { ScimExceptionFilter } from './scim.filter.js';

afterEach(() => vi.restoreAllMocks());
function respond(error: unknown) {
  const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  const reply = { status: vi.fn(), header: vi.fn(), send: vi.fn() };
  reply.status.mockReturnValue(reply);
  reply.header.mockReturnValue(reply);
  const host = {
    switchToHttp: () => ({
      getResponse: () => reply,
      getRequest: () => ({ id: 'synthetic-correlation' }),
    }),
  } as unknown as ArgumentsHost;
  new ScimExceptionFilter().catch(error, host);
  return {
    reply,
    logged,
    body: reply.send.mock.calls[0]![0] as { status: string; detail: string; scimType?: string },
  };
}

it.each([
  [
    new ScimError(409, 'Synthetic duplicate', 'uniqueness'),
    409,
    'Synthetic duplicate',
    'uniqueness',
  ],
  [new ScimError(404, 'Synthetic missing'), 404, 'Synthetic missing', undefined],
  [
    new ValidationError([
      { path: '/active', message: 'Expected boolean' },
      { path: '/emails', message: 'Expected email' },
    ]),
    400,
    '/active: Expected boolean; /emails: Expected email',
    'invalidValue',
  ],
  [new ValidationError([]), 400, 'Invalid request', 'invalidValue'],
  [new DomainError('VERBIS_AUTH_UNAUTHENTICATED'), 401, 'VERBIS_AUTH_UNAUTHENTICATED', undefined],
  [
    new DomainError('VERBIS_AUTHZ_FORBIDDEN', 'Synthetic denied'),
    403,
    'Synthetic denied',
    undefined,
  ],
  [new DomainError('VERBIS_TENANT_INACTIVE'), 403, 'VERBIS_TENANT_INACTIVE', undefined],
  [
    new DomainError('VERBIS_RESOURCE_NOT_FOUND', 'Synthetic missing'),
    400,
    'Synthetic missing',
    undefined,
  ],
  [new HttpException('synthetic-private-message', 429), 429, 'Too many requests', 'tooMany'],
  [new HttpException('synthetic-private-message', 403), 403, 'Request rejected', undefined],
  [new HttpException('synthetic-private-message', 503), 503, 'Internal error', undefined],
  [
    { statusCode: 400, message: 'synthetic-private-message' },
    400,
    'Request rejected',
    'invalidSyntax',
  ],
  [{ statusCode: 429, message: 'synthetic-private-message' }, 429, 'Too many requests', undefined],
  [{ statusCode: 401 }, 401, 'Request rejected', undefined],
  [{ statusCode: '403' }, 500, 'Internal error', undefined],
  [{ statusCode: 200 }, 500, 'Internal error', undefined],
  [{ statusCode: 500 }, 500, 'Internal error', undefined],
  [new Error('synthetic-private-message'), 500, 'Internal error', undefined],
  [null, 500, 'Internal error', undefined],
  ['synthetic-private-message', 500, 'Internal error', undefined],
] as const)('returns the SCIM wire contract for error %j', (error, status, detail, scimType) => {
  const { reply, body, logged } = respond(error);
  expect(reply.status).toHaveBeenCalledWith(status);
  expect(reply.header).toHaveBeenCalledWith('content-type', SCIM_CONTENT_TYPE);
  expect(body).toEqual({
    schemas: [SCIM_ERROR_SCHEMA],
    status: String(status),
    detail,
    ...(scimType === undefined ? {} : { scimType }),
  });
  expect(JSON.stringify(body)).not.toContain('synthetic-private-message');
  if (status === 401)
    expect(reply.header).toHaveBeenCalledWith('www-authenticate', 'Bearer realm="scim"');
  if (status >= 500) {
    expect(logged).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logged.mock.calls)).toContain('synthetic-correlation');
    expect(JSON.stringify(logged.mock.calls)).not.toContain('synthetic-private-message');
  } else expect(logged).not.toHaveBeenCalled();
});
