import { createHash } from 'node:crypto';

import { RequestMethod, type Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { z } from 'zod';

import { ProblemDetailsSchema } from '@verbis/shared-types';

import { IS_PUBLIC } from '../common/security/public.decorator.js';

import { getControllerTag, getRouteDoc, type RouteDoc } from './metadata.js';

type JsonObject = Record<string, unknown>;

export interface OpenApiInfo {
  readonly title: string;
  readonly version: string;
  readonly description?: string;
}

const METHODS: Partial<Record<RequestMethod, string>> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.PATCH]: 'patch',
  [RequestMethod.DELETE]: 'delete',
};

const PROBLEM_REF = { $ref: '#/components/schemas/ProblemDetails' };

/** Default error response per error format; protocol endpoints follow their own standard (ADR-0012). */
const ERROR_RESPONSES: Record<NonNullable<RouteDoc['errorFormat']> | 'problem', JsonObject> = {
  problem: {
    description: 'Error (RFC 7807)',
    content: { 'application/problem+json': { schema: PROBLEM_REF } },
  },
  scim: {
    description: 'Error (RFC 7644 §3.12)',
    content: {
      'application/scim+json': {
        schema: {
          type: 'object',
          required: ['schemas', 'status'],
          properties: {
            schemas: { type: 'array', items: { type: 'string' } },
            status: { type: 'string' },
            scimType: { type: 'string' },
            detail: { type: 'string' },
          },
        },
      },
    },
  },
  oauth: {
    description: 'Error (RFC 6749 §5.2)',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['error'],
          properties: { error: { type: 'string' }, error_description: { type: 'string' } },
        },
      },
    },
  },
  redirect: {
    description:
      'Browser protocol endpoint: failures redirect back to the app with ?authError=<code>, or RFC 7807',
    content: { 'application/problem+json': { schema: PROBLEM_REF } },
  },
};

function joinPath(...parts: (string | undefined)[]): string {
  const joined = parts
    .filter((part): part is string => part !== undefined && part !== '' && part !== '/')
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .join('/');
  return `/${joined}`.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

/**
 * Converts zod schemas to JSON Schema 2020-12 (native to OpenAPI 3.1). Schemas with `.meta({ id })`
 * become reusable components; everything else is inlined.
 */
class SchemaRegistry {
  readonly components: Record<string, JsonObject> = {};

  convert(schema: z.ZodType, io: 'input' | 'output'): JsonObject {
    const json = z.toJSONSchema(schema, {
      target: 'draft-2020-12',
      io,
      unrepresentable: 'any',
      reused: 'inline',
      cycles: 'ref',
      override: (ctx) => {
        // Dates arrive as ISO strings on the wire.
        if (ctx.zodSchema._zod.def.type === 'date') {
          ctx.jsonSchema.type = 'string';
          ctx.jsonSchema.format = 'date-time';
        }
      },
    }) as JsonObject;
    return this.hoist(json);
  }

  /** Moves $defs into components and rewrites refs. Anonymous defs get content-hashed names. */
  private hoist(json: JsonObject): JsonObject {
    const defs = (json['$defs'] ?? {}) as Record<string, JsonObject>;
    delete json['$defs'];
    delete json['$schema'];
    const names = new Map<string, string>();
    for (const [name, def] of Object.entries(defs)) {
      const anonymous = /^__schema\d+$/.test(name);
      const hash = createHash('sha256').update(JSON.stringify(def)).digest('hex').slice(0, 10);
      names.set(name, anonymous ? `Inline${hash}` : name);
    }
    const rewrite = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(rewrite);
      if (value === null || typeof value !== 'object') return value;
      const out: JsonObject = {};
      for (const [key, item] of Object.entries(value)) {
        if (key === '$ref' && typeof item === 'string' && item.startsWith('#/$defs/')) {
          const name = item.slice('#/$defs/'.length);
          out[key] = `#/components/schemas/${names.get(name) ?? name}`;
        } else {
          out[key] = rewrite(item);
        }
      }
      return out;
    };
    for (const [name, def] of Object.entries(defs)) {
      this.components[names.get(name) ?? name] = rewrite(def) as JsonObject;
    }
    const id = json['id'];
    const root = rewrite(json) as JsonObject;
    if (typeof id === 'string') {
      delete root['id'];
      this.components[id] = root;
      return { $ref: `#/components/schemas/${id}` };
    }
    return root;
  }
}

function queryParameters(schema: z.ZodType, registry: SchemaRegistry): JsonObject[] {
  const json = registry.convert(schema, 'input');
  const properties = (json['properties'] ?? {}) as Record<string, JsonObject>;
  const required = new Set((json['required'] ?? []) as string[]);
  return Object.entries(properties).map(([name, property]) => ({
    name,
    in: 'query',
    required: required.has(name),
    schema: property,
    ...(typeof property['description'] === 'string'
      ? { description: property['description'] }
      : {}),
  }));
}

/** Builds the OpenAPI 3.1 document from controller metadata (deterministic order). */
export function buildOpenApiDocument(controllers: readonly Type[], info: OpenApiInfo): JsonObject {
  const registry = new SchemaRegistry();
  registry.components['ProblemDetails'] = registry.convert(ProblemDetailsSchema, 'output');
  const paths: Record<string, Record<string, JsonObject>> = {};

  for (const controller of controllers) {
    const basePath = Reflect.getMetadata(PATH_METADATA, controller) as string | undefined;
    const tag = getControllerTag(controller);
    const classPublic = Reflect.getMetadata(IS_PUBLIC, controller) === true;
    const prototype = controller.prototype as Record<string, unknown>;
    for (const key of Object.getOwnPropertyNames(prototype)) {
      const handler = prototype[key];
      if (key === 'constructor' || typeof handler !== 'function') continue;
      const methodPath = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      if (methodPath === undefined || method === undefined) continue;
      const verb = METHODS[method];
      if (verb === undefined) continue;
      const doc: RouteDoc = getRouteDoc(prototype, key) ?? {};
      const isPublic = classPublic || Reflect.getMetadata(IS_PUBLIC, handler) === true;
      const path = joinPath(basePath, methodPath);

      const parameters: JsonObject[] = [];
      for (const [name, schema] of Object.entries(doc.params ?? {})) {
        parameters.push({
          name,
          in: 'path',
          required: true,
          schema: registry.convert(schema, 'input'),
        });
      }
      if (doc.query !== undefined) parameters.push(...queryParameters(doc.query, registry));
      if (doc.idempotent === true) {
        parameters.push({
          name: 'Idempotency-Key',
          in: 'header',
          required: false,
          description:
            'Makes the POST safely retryable for 24 hours (same key + same body ⇒ same response).',
          schema: { type: 'string', pattern: '^[A-Za-z0-9._:-]{8,255}$' },
        });
      }
      if (doc.requiresIfMatch === true) {
        parameters.push({
          name: 'If-Match',
          in: 'header',
          required: true,
          description: 'Current ETag (optimistic locking).',
          schema: { type: 'string' },
        });
      }

      const responses: Record<string, JsonObject> = {};
      for (const [status, response] of Object.entries(doc.responses ?? {})) {
        responses[status] = {
          description: response.description,
          ...(response.headers === undefined
            ? {}
            : {
                headers: Object.fromEntries(
                  Object.entries(response.headers).map(([name, description]) => [
                    name,
                    { description, schema: { type: 'string' } },
                  ]),
                ),
              }),
          ...(response.schema === undefined
            ? {}
            : {
                content: {
                  'application/json': { schema: registry.convert(response.schema, 'output') },
                },
              }),
        };
      }
      responses['default'] = ERROR_RESPONSES[doc.errorFormat ?? 'problem'];

      const permissions = doc.permissions ?? [];
      paths[path] ??= {};
      paths[path][verb] = {
        operationId: `${controller.name.replace(/Controller$/, '')}.${key}`,
        ...(tag === undefined ? {} : { tags: [tag] }),
        ...(doc.summary === undefined ? {} : { summary: doc.summary }),
        description:
          [
            doc.description,
            permissions.length > 0 ? `Requires: ${permissions.join(', ')}` : undefined,
          ]
            .filter(Boolean)
            .join('\n\n') || undefined,
        ...(parameters.length === 0 ? {} : { parameters }),
        ...(doc.body === undefined
          ? {}
          : {
              requestBody: {
                required: true,
                content: {
                  [doc.mediaType ?? 'application/json']: {
                    schema: registry.convert(doc.body, 'input'),
                  },
                },
              },
            }),
        responses,
        security:
          doc.security !== undefined
            ? doc.security.map((name) => ({ [name]: [] }))
            : isPublic
              ? []
              : [{ internalJwt: [] }, { sessionCookie: [] }],
        ...(permissions.length > 0 ? { 'x-verbis-permissions': permissions } : {}),
      };
    }
  }

  const sortedPaths = Object.fromEntries(
    Object.entries(paths).sort(([a], [b]) => a.localeCompare(b)),
  );
  const sortedSchemas = Object.fromEntries(
    Object.entries(registry.components).sort(([a], [b]) => a.localeCompare(b)),
  );
  return JSON.parse(
    JSON.stringify({
      openapi: '3.1.0',
      jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
      info: {
        title: info.title,
        version: info.version,
        ...(info.description === undefined ? {} : { description: info.description }),
      },
      servers: [{ url: '/' }],
      paths: sortedPaths,
      components: {
        schemas: sortedSchemas,
        securitySchemes: {
          internalJwt: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description:
              'Short-lived, audience-bound internal token minted by the BFF or the client-credentials grant (ADR-0004, ADR-0012).',
          },
          sessionCookie: {
            type: 'apiKey',
            in: 'cookie',
            name: '__Host-verbis_session',
            description:
              'Opaque BFF session cookie (httpOnly). State-changing requests also need X-CSRF-Token and an allowed Origin.',
          },
          scimBearer: {
            type: 'http',
            scheme: 'bearer',
            description: 'Per-IdP SCIM token (vscim_…) issued in the admin API.',
          },
          oauthClient: {
            type: 'http',
            scheme: 'basic',
            description:
              'Service client credentials (client_secret_basic/post) or a TLS client certificate (RFC 8705).',
          },
        },
      },
    }),
  ) as JsonObject;
}
