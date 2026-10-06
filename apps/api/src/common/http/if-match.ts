import { PreconditionRequiredError, VersionMismatchError } from '../errors/domain-errors.js';

import type { FastifyReply, FastifyRequest } from 'fastify';

/** Strong ETag for an optimistic-lock version. */
export function etagFor(version: number): string {
  return `"${version}"`;
}

export function setEtag(reply: FastifyReply, version: number): void {
  void reply.header('etag', etagFor(version));
}

/** Expected version from `If-Match: "<version>"` (weak validators accepted). Required for writes. */
export function expectedVersion(request: FastifyRequest): number {
  const header = request.headers['if-match'];
  if (header === undefined) throw new PreconditionRequiredError();
  const match = /^(?:W\/)?"([1-9][0-9]{0,9})"$/.exec(header.trim());
  if (match?.[1] === undefined) throw new VersionMismatchError();
  return Number(match[1]);
}
