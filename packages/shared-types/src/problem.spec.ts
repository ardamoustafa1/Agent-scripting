import { describe, expect, it } from 'vitest';

import {
  isProblemCode,
  PROBLEM_CATALOG,
  ProblemDetailsSchema,
  problemForCode,
  problemForStatus,
} from './problem.js';

describe('problemForStatus', () => {
  it('maps known 4xx statuses with detail', () => {
    const p = problemForStatus(404, {
      instance: '/v1/x',
      detail: 'No such thing',
      correlationId: 'c1',
    });
    expect(p).toEqual({
      type: 'https://errors.verbis.io/not-found',
      title: 'Not Found',
      status: 404,
      code: 'VERBIS_HTTP_NOT_FOUND',
      instance: '/v1/x',
      detail: 'No such thing',
      correlationId: 'c1',
    });
    expect(ProblemDetailsSchema.parse(p)).toEqual(p);
  });

  it('never exposes detail on 5xx', () => {
    const p = problemForStatus(500, { detail: 'stack trace here' });
    expect(p.detail).toBeUndefined();
    expect(p.code).toBe('VERBIS_HTTP_INTERNAL');
  });

  it('normalizes invalid statuses to 500', () => {
    expect(problemForStatus(200).status).toBe(500);
    expect(problemForStatus(Number.NaN).status).toBe(500);
  });

  it('falls back to generic metadata for unmapped 4xx', () => {
    expect(problemForStatus(418).code).toBe('VERBIS_HTTP_CLIENT_ERROR');
    expect(problemForStatus(502).code).toBe('VERBIS_HTTP_INTERNAL');
    expect(problemForStatus(418).status).toBe(418);
  });
});

describe('problemForCode', () => {
  it('builds catalogued problems with errors', () => {
    const p = problemForCode('VERBIS_SCRIPT_DOCUMENT_INVALID', {
      instance: '/v1/scripts/1/versions',
      correlationId: 'c1',
      detail: 'Fix the listed issues.',
      errors: [{ path: '/flow', message: 'script.validation.flowCycle', code: 'FLOW_CYCLE' }],
    });
    expect(p).toEqual({
      type: 'https://errors.verbis.io/script/document-invalid',
      title: 'Script document is invalid',
      status: 422,
      code: 'VERBIS_SCRIPT_DOCUMENT_INVALID',
      instance: '/v1/scripts/1/versions',
      correlationId: 'c1',
      detail: 'Fix the listed issues.',
      errors: [{ path: '/flow', message: 'script.validation.flowCycle', code: 'FLOW_CYCLE' }],
    });
    expect(ProblemDetailsSchema.parse(p)).toEqual(p);
  });

  it('omits empty error lists', () => {
    expect(problemForCode('VERBIS_VALIDATION_FAILED', { errors: [] }).errors).toBeUndefined();
  });

  it('catalogue codes follow the VERBIS_<AREA>_<NAME> format', () => {
    for (const [code, meta] of Object.entries(PROBLEM_CATALOG)) {
      expect(ProblemDetailsSchema.shape.code.safeParse(code).success).toBe(true);
      expect(meta.status).toBeGreaterThanOrEqual(400);
    }
  });

  it('recognizes catalogue codes', () => {
    expect(isProblemCode('VERBIS_AUTHZ_FORBIDDEN')).toBe(true);
    expect(isProblemCode('toString')).toBe(false);
  });
});
