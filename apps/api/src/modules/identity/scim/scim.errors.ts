/** RFC 7644 §3.12 error (`urn:ietf:params:scim:api:messages:2.0:Error`). */
export type ScimErrorType =
  | 'invalidFilter'
  | 'tooMany'
  | 'uniqueness'
  | 'mutability'
  | 'invalidSyntax'
  | 'invalidPath'
  | 'noTarget'
  | 'invalidValue'
  | 'invalidVers'
  | 'sensitive';

export class ScimError extends Error {
  override readonly name = 'ScimError';
  constructor(
    readonly status: number,
    readonly detail: string,
    readonly scimType?: ScimErrorType,
  ) {
    super(detail);
  }
}

export const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';
export const SCIM_CONTENT_TYPE = 'application/scim+json; charset=utf-8';
