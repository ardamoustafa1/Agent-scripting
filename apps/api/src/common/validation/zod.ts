import { Body, type PipeTransform, Param, Query } from '@nestjs/common';

import { appendRouteDoc } from '../../openapi/metadata.js';
import { ValidationError } from '../errors/domain-errors.js';

import type { z } from 'zod';

/** JSON Pointer for a zod issue path. */
export function issuePointer(path: readonly PropertyKey[]): string {
  return path
    .map((segment) => `/${String(segment).replace(/~/g, '~0').replace(/\//g, '~1')}`)
    .join('');
}

/** Validates and transforms input with a zod schema; failures become RFC 7807 400s. */
export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(
    readonly schema: S,
    private readonly location: 'body' | 'query' | 'path',
  ) {}

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new ValidationError(
      result.error.issues.map((issue) => ({
        path: `/${this.location}${issuePointer(issue.path)}`,
        // zod messages are developer-facing English; the stable code drives localized UI text.
        message: issue.message,
        code: issue.code,
      })),
    );
  }
}

/** `@ZBody(schema)`: validated request body, documented in OpenAPI. */
export function ZBody(schema: z.ZodType): ParameterDecorator {
  return (target, key, index) => {
    Body(new ZodValidationPipe(schema, 'body'))(target, key, index);
    if (key !== undefined) appendRouteDoc(target, key, { body: schema });
  };
}

/** `@ZQuery(schema)`: validated query string object. */
export function ZQuery(schema: z.ZodType): ParameterDecorator {
  return (target, key, index) => {
    Query(new ZodValidationPipe(schema, 'query'))(target, key, index);
    if (key !== undefined) appendRouteDoc(target, key, { query: schema });
  };
}

/** `@ZParam('id', schema)`: validated path parameter. */
export function ZParam(name: string, schema: z.ZodType): ParameterDecorator {
  return (target, key, index) => {
    Param(name, new ZodValidationPipe(schema, 'path'))(target, key, index);
    if (key !== undefined) appendRouteDoc(target, key, { params: { [name]: schema } });
  };
}
