import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  PreconditionRequiredError,
  UnauthenticatedError,
  ValidationError,
  VersionMismatchError,
} from './domain-errors.js';
import { sqlStateOf, toProblem } from './to-problem.js';

const req = { url: '/v1/campaigns?q=secret', correlationId: 'corr-1' };

describe('toProblem', () => {
  it.each([
    [new NotFoundError('Campaign'), 404, 'VERBIS_RESOURCE_NOT_FOUND'],
    [new ForbiddenError(), 403, 'VERBIS_AUTHZ_FORBIDDEN'],
    [new ConflictError(), 409, 'VERBIS_RESOURCE_CONFLICT'],
    [new PreconditionRequiredError(), 428, 'VERBIS_CONCURRENCY_PRECONDITION_REQUIRED'],
    [new VersionMismatchError(), 412, 'VERBIS_CONCURRENCY_VERSION_MISMATCH'],
    [
      new ValidationError([{ path: '/body/x', message: 'bad', code: 'invalid_type' }]),
      400,
      'VERBIS_VALIDATION_FAILED',
    ],
    [new DomainError('VERBIS_TENANT_INACTIVE'), 403, 'VERBIS_TENANT_INACTIVE'],
  ])('maps %s', (error, status, code) => {
    const { problem, unexpected } = toProblem(error, req);
    expect(problem).toMatchObject({
      status,
      code,
      instance: '/v1/campaigns',
      correlationId: 'corr-1',
    });
    expect(unexpected).toBe(false);
  });

  it('carries headers and errors of domain errors', () => {
    expect(toProblem(new UnauthenticatedError(), req).headers).toEqual({
      'www-authenticate': 'Bearer',
    });
    expect(toProblem(new VersionMismatchError(7), req).headers).toEqual({ etag: '"7"' });
    expect(
      toProblem(new ValidationError([{ path: '/a', message: 'm' }]), req).problem.errors,
    ).toEqual([{ path: '/a', message: 'm' }]);
  });

  it('never echoes query strings from Nest messages and maps catalogued statuses', () => {
    expect(toProblem(new NotFoundException('Cannot GET /x?token=secret'), req).problem.detail).toBe(
      'Cannot GET /x',
    );
    expect(toProblem(new PayloadTooLargeException(), req).problem.code).toBe(
      'VERBIS_HTTP_PAYLOAD_TOO_LARGE',
    );
  });

  it('maps Nest HTTP exceptions and hides 5xx detail', () => {
    expect(toProblem(new BadRequestException('nope'), req).problem).toMatchObject({
      status: 400,
      detail: 'nope',
    });
    const internal = toProblem(new InternalServerErrorException('db password leaked'), req);
    expect(internal.unexpected).toBe(true);
    expect(JSON.stringify(internal.problem)).not.toContain('leaked');
  });

  it('maps Fastify, rate-limit and Prisma errors', () => {
    expect(
      toProblem({ code: 'FST_ERR_CTP_BODY_TOO_LARGE', statusCode: 413 }, req).problem.code,
    ).toBe('VERBIS_HTTP_PAYLOAD_TOO_LARGE');
    expect(toProblem({ code: 'FST_ERR_CTP_INVALID_MEDIA_TYPE' }, req).problem.status).toBe(415);
    expect(toProblem({ statusCode: 429, message: 'slow down' }, req).problem.code).toBe(
      'VERBIS_HTTP_RATE_LIMITED',
    );
    expect(toProblem({ code: 'P2002' }, req).problem.code).toBe('VERBIS_RESOURCE_CONFLICT');
    expect(toProblem({ code: 'P2025' }, req).problem.code).toBe('VERBIS_RESOURCE_NOT_FOUND');
    expect(toProblem({ cause: { originalCode: '23505' } }, req).problem.code).toBe(
      'VERBIS_RESOURCE_CONFLICT',
    );
    expect(toProblem({ statusCode: 405 }, req).problem.status).toBe(405);
  });

  it('denies row-level security violations as unexpected', () => {
    const result = toProblem(
      { meta: { driverAdapterError: { cause: { originalCode: '42501' } } } },
      req,
    );
    expect(result.problem.code).toBe('VERBIS_AUTHZ_FORBIDDEN');
    expect(result.unexpected).toBe(true);
  });

  it('hides everything else behind a 500', () => {
    for (const error of [new Error('secret'), 'boom', null, { statusCode: 'x' }]) {
      const { problem, unexpected } = toProblem(error, req);
      expect(problem.status).toBe(500);
      expect(problem.detail).toBeUndefined();
      expect(unexpected).toBe(true);
    }
  });
});

describe('sqlStateOf', () => {
  it('finds SQLSTATE codes in nested chains and stops at depth', () => {
    expect(sqlStateOf({ code: '42501' })).toBe('42501');
    expect(sqlStateOf({ sqlState: '23505' })).toBe('23505');
    expect(sqlStateOf({ code: 'P2002' })).toBeUndefined();
    let deep: Record<string, unknown> = { originalCode: '42501' };
    for (let i = 0; i < 10; i += 1) deep = { cause: deep };
    expect(sqlStateOf(deep)).toBeUndefined();
  });
});
