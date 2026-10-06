import type { z } from 'zod';

/** OpenAPI facts recorded by decorators; consumed by the generator (src/openapi/generator.ts). */
export interface RouteDoc {
  summary?: string;
  description?: string;
  body?: z.ZodType;
  query?: z.ZodType;
  params?: Record<string, z.ZodType>;
  responses?: Record<
    number,
    { description: string; schema?: z.ZodType; headers?: Record<string, string> }
  >;
  permissions?: readonly string[];
  idempotent?: boolean;
  requiresIfMatch?: boolean;
  public?: boolean;
  /** Protocol endpoints whose errors follow their own standard instead of RFC 7807 (ADR-0012). */
  errorFormat?: 'scim' | 'oauth' | 'redirect';
  /** Security scheme names (default: internal JWT or session cookie for non-public routes). */
  security?: readonly string[];
  /** Media type of request/response bodies when not application/json. */
  mediaType?: string;
}

const ROUTE_DOC = Symbol('verbis:route-doc');
const CONTROLLER_TAG = Symbol('verbis:controller-tag');

type DocTarget = object & { [ROUTE_DOC]?: Map<string | symbol, RouteDoc> };

export function appendRouteDoc(target: object, key: string | symbol, doc: RouteDoc): void {
  const holder = target as DocTarget;
  if (!Object.hasOwn(holder, ROUTE_DOC)) {
    Object.defineProperty(holder, ROUTE_DOC, {
      value: new Map<string | symbol, RouteDoc>(),
      enumerable: false,
    });
  }
  const map = holder[ROUTE_DOC];
  if (map === undefined) return;
  const current = map.get(key) ?? {};
  map.set(key, {
    ...current,
    ...doc,
    params: { ...current.params, ...doc.params },
    responses: { ...current.responses, ...doc.responses },
    permissions: [...(current.permissions ?? []), ...(doc.permissions ?? [])],
  });
}

export function getRouteDoc(prototype: object, key: string | symbol): RouteDoc | undefined {
  return (prototype as DocTarget)[ROUTE_DOC]?.get(key);
}

/** `@ApiOperation({ summary })` */
export function ApiOperation(doc: Pick<RouteDoc, 'summary' | 'description'>): MethodDecorator {
  return (target, key) => {
    appendRouteDoc(target, key, doc);
  };
}

/** `@ApiResponse(200, 'Campaign', CampaignSchema)` */
export function ApiResponse(
  status: number,
  description: string,
  schema?: z.ZodType,
  headers?: Record<string, string>,
): MethodDecorator {
  return (target, key) => {
    appendRouteDoc(target, key, {
      responses: {
        [status]: {
          description,
          ...(schema === undefined ? {} : { schema }),
          ...(headers === undefined ? {} : { headers }),
        },
      },
    });
  };
}

/** Controller tag shown in the OpenAPI document. */
export function ApiTag(tag: string): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(CONTROLLER_TAG, tag, target);
  };
}

export function getControllerTag(controller: object): string | undefined {
  return Reflect.getMetadata(CONTROLLER_TAG, controller) as string | undefined;
}

/** Documents Idempotency-Key support (the interceptor applies to every authenticated POST). */
export function Idempotent(): MethodDecorator {
  return (target, key) => {
    appendRouteDoc(target, key, { idempotent: true });
  };
}

/** Documents the required If-Match header (optimistic locking). */
export function RequiresIfMatch(): MethodDecorator {
  return (target, key) => {
    appendRouteDoc(target, key, { requiresIfMatch: true });
  };
}

/** Marks a standards-defined protocol endpoint (SCIM, OAuth 2.0, browser SSO redirects). */
export function ApiProtocol(
  doc: Pick<RouteDoc, 'errorFormat' | 'security' | 'mediaType'>,
): MethodDecorator {
  return (target, key) => {
    appendRouteDoc(target, key, doc);
  };
}
