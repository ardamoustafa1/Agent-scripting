import { SetMetadata } from '@nestjs/common';

export const AUDIT_READ = 'verbis:audit-read';
export const SKIP_AUDIT = 'verbis:skip-audit';

export interface AuditReadOptions {
  /** e.g. `secret.metadata.viewed`, `identity.user.piiRevealed`. */
  readonly action: string;
  readonly resourceType: string;
  /** Route param that identifies the resource (default `id`; `*` for collections). */
  readonly idParam?: string;
}

/** Sensitive read: the successful response is audited in the request transaction. */
export const AuditRead = (options: AuditReadOptions): MethodDecorator =>
  SetMetadata(AUDIT_READ, options);

/**
 * Opt out of the generic mutation event, for handlers that always write their own domain audit
 * event (or that are not state changing despite the HTTP method, e.g. search via POST).
 */
export const SkipAudit = (): MethodDecorator => SetMetadata(SKIP_AUDIT, true);
