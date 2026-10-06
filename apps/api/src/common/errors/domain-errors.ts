import type { ProblemCode, ProblemDetails } from '@verbis/shared-types';

/** An expected failure with a catalogued problem code (RFC 7807). `detail` must be safe to show. */
export class DomainError extends Error {
  override readonly name: string = 'DomainError';

  constructor(
    readonly code: ProblemCode,
    readonly detail?: string,
    readonly errors?: ProblemDetails['errors'],
    readonly headers?: Readonly<Record<string, string>>,
  ) {
    super(detail ?? code);
  }
}

export class NotFoundError extends DomainError {
  override readonly name = 'NotFoundError';

  constructor(resource: string) {
    super('VERBIS_RESOURCE_NOT_FOUND', `${resource} not found`);
  }
}

export class UnauthenticatedError extends DomainError {
  override readonly name = 'UnauthenticatedError';

  constructor() {
    super('VERBIS_AUTH_UNAUTHENTICATED', 'Authentication is required', undefined, {
      'www-authenticate': 'Bearer',
    });
  }
}

export class ForbiddenError extends DomainError {
  override readonly name = 'ForbiddenError';

  constructor(detail = 'You do not have permission to perform this action') {
    super('VERBIS_AUTHZ_FORBIDDEN', detail);
  }
}

export class ValidationError extends DomainError {
  override readonly name = 'ValidationError';

  constructor(errors: NonNullable<ProblemDetails['errors']>, detail = 'The request is invalid') {
    super('VERBIS_VALIDATION_FAILED', detail, errors);
  }
}

export class VersionMismatchError extends DomainError {
  override readonly name = 'VersionMismatchError';

  constructor(current?: number) {
    super(
      'VERBIS_CONCURRENCY_VERSION_MISMATCH',
      'The resource was modified by someone else; reload and retry',
      undefined,
      current === undefined ? undefined : { etag: `"${current}"` },
    );
  }
}

export class PreconditionRequiredError extends DomainError {
  override readonly name = 'PreconditionRequiredError';

  constructor() {
    super('VERBIS_CONCURRENCY_PRECONDITION_REQUIRED', 'Send If-Match with the current ETag');
  }
}

export class ConflictError extends DomainError {
  override readonly name = 'ConflictError';

  constructor(detail = 'The resource conflicts with an existing one') {
    super('VERBIS_RESOURCE_CONFLICT', detail);
  }
}

/** A security event to record after the request transaction rolled back. */
export interface DeferredAuditEvent {
  readonly action: string;
  readonly target: { readonly type: string; readonly id: string };
  readonly reason: string;
  readonly outcome?: 'denied' | 'failure';
  readonly interactionId?: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * A refusal whose audit trail is more specific than the generic `api.request.denied`: the
 * outermost failure interceptor writes `events` in a fresh transaction (they would otherwise roll
 * back with the request). The client still receives only `code`/`detail`.
 */
export class AuditedDomainError extends DomainError {
  override readonly name = 'AuditedDomainError';

  constructor(
    code: ProblemCode,
    detail: string,
    readonly events: readonly DeferredAuditEvent[],
    headers?: Readonly<Record<string, string>>,
  ) {
    super(code, detail, undefined, headers);
  }
}
