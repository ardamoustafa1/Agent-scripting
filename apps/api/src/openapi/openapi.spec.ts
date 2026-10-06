import { readFileSync } from 'node:fs';

import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it } from 'vitest';

import { allControllers } from '../app.module.js';
import { IS_PUBLIC } from '../common/security/public.decorator.js';
import { ANY_AUTHENTICATED, REQUIRED_PERMISSIONS } from '../modules/authz/permissions.js';

import { openApiDocument } from './docs.js';

interface Operation {
  security: unknown[];
  responses: Record<string, { content?: Record<string, unknown> }>;
  'x-verbis-permissions'?: string[];
  parameters?: { name: string }[];
}

describe('OpenAPI document', () => {
  const document = openApiDocument('1.0.0') as {
    openapi: string;
    paths: Record<string, Record<string, Operation>>;
    components: { schemas: Record<string, unknown> };
  };

  it('is OpenAPI 3.1 with RFC 7807 errors on every non-protocol operation', () => {
    expect(document.openapi).toBe('3.1.0');
    const protocolPaths = /^\/(scim\/v2|oauth2|auth\/(oidc|saml|login|logout))/;
    for (const [path, operations] of Object.entries(document.paths)) {
      if (
        protocolPaths.test(path) ||
        /^\/v1\/(genesys-cloud|genesys-engage)\/(?:connectors\/[^/]+\/)?oauth\//.test(path)
      )
        continue;
      for (const operation of Object.values(operations)) {
        expect(operation.responses['default'], path).toEqual({
          description: 'Error (RFC 7807)',
          content: {
            'application/problem+json': { schema: { $ref: '#/components/schemas/ProblemDetails' } },
          },
        });
      }
    }
  });

  it('documents SCIM and OAuth endpoints with their standard error formats', () => {
    const scim = document.paths['/scim/v2/{tenant}/Users']?.['get'];
    expect(Object.keys(scim?.responses['default']?.content ?? {})).toEqual([
      'application/scim+json',
    ]);
    const token = document.paths['/oauth2/{tenant}/token']?.['post'];
    expect(Object.keys(token?.responses['default']?.content ?? {})).toEqual(['application/json']);
  });

  it('resolves every $ref', () => {
    const refs = JSON.stringify(document).match(/"#\/components\/schemas\/([^"]+)"/g) ?? [];
    for (const ref of refs)
      expect(document.components.schemas).toHaveProperty(
        ref.slice('"#/components/schemas/'.length, -1),
      );
  });

  it('documents Idempotency-Key on creating POSTs and If-Match on writes', () => {
    const header = (path: string, method: string) =>
      document.paths[path]?.[method]?.parameters?.map((p) => p.name) ?? [];
    expect(header('/v1/campaigns', 'post')).toContain('Idempotency-Key');
    expect(header('/v1/campaigns/{id}', 'patch')).toContain('If-Match');
    expect(header('/v1/campaigns/{id}', 'delete')).toContain('If-Match');
  });

  it('matches the committed openapi.json (run `pnpm --filter @verbis/api openapi:generate`)', () => {
    const committed: unknown = JSON.parse(
      readFileSync(new URL('../../openapi.json', import.meta.url), 'utf8'),
    );
    expect(committed).toEqual(document);
  });
});

describe('route catalogue (deny by default)', () => {
  it('every non-public route declares permissions or @AnyAuthenticated()', () => {
    const offenders: string[] = [];
    for (const controller of allControllers()) {
      const classPublic = Reflect.getMetadata(IS_PUBLIC, controller) === true;
      const prototype = controller.prototype as Record<string, unknown>;
      for (const key of Object.getOwnPropertyNames(prototype)) {
        const handler = prototype[key];
        if (
          typeof handler !== 'function' ||
          Reflect.getMetadata(METHOD_METADATA, handler) === undefined
        )
          continue;
        if (classPublic || Reflect.getMetadata(IS_PUBLIC, handler) === true) continue;
        const permissions =
          (Reflect.getMetadata(REQUIRED_PERMISSIONS, handler) as string[] | undefined) ?? [];
        if (permissions.length === 0 && Reflect.getMetadata(ANY_AUTHENTICATED, handler) !== true) {
          offenders.push(
            `${controller.name}.${key} ${String(Reflect.getMetadata(PATH_METADATA, handler))}`,
          );
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never exposes a route that opens scripts by query parameters (CLAUDE.md rule 11)', () => {
    const document = JSON.stringify(openApiDocument('1.0.0'));
    for (const name of ['campaignId', 'scriptId', 'userId', 'interactionId']) {
      // Filters exist on list endpoints; no route may render or launch a script from them.
      expect(document).not.toMatch(new RegExp(`/launch[^"]*\\{${name}\\}`));
    }
  });
});
