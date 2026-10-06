import { requestContext } from './context/request-context.js';
import { actorRef } from './security/principal.js';

/** Actor reference of the current request principal (created_by/updated_by). */
export function currentActor(): string {
  const principal = requestContext.require().principal;
  if (principal === undefined) throw new Error('No principal in the current context');
  return actorRef(principal);
}
