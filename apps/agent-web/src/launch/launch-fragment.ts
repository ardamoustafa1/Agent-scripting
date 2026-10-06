/**
 * Launch material arrives only in the URL *fragment* (never sent to servers, logs or Referer) and
 * is scrubbed from the address bar and history immediately (SECURITY §4.5). Query parameters are
 * never read for content; identifying ones are only reported as a security signal.
 */
export type LaunchMaterial =
  | { readonly kind: 'code'; readonly code: string }
  | { readonly kind: 'jws'; readonly token: string }
  | { readonly kind: 'embedded'; readonly connectorId: string; readonly conversationId: string };

const CODE = /^[A-Za-z0-9_-]{43}$/;
const JWS = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONVERSATION = /^[A-Za-z0-9._:-]{1,256}$/;

export function parseLaunchFragment(hash: string): LaunchMaterial | undefined {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const code = params.get('code');
  if (code !== null) return CODE.test(code) ? { kind: 'code', code } : undefined;
  const token = params.get('jws');
  if (token !== null)
    return token.length <= 4096 && JWS.test(token) ? { kind: 'jws', token } : undefined;
  const connectorId = params.get('connector');
  const conversationId = params.get('conversation');
  if (connectorId !== null && conversationId !== null)
    return UUID.test(connectorId) && CONVERSATION.test(conversationId)
      ? { kind: 'embedded', connectorId, conversationId }
      : undefined;
  return undefined;
}

export const IDENTIFYING_PARAMS = [
  'campaignid',
  'campaign',
  'scriptid',
  'script',
  'userid',
  'user',
  'agentid',
  'interactionid',
  'interaction',
  'conversationid',
  'customerid',
  'sessionid',
] as const;

export function identifyingParams(search: string): string[] {
  const names = [...new URLSearchParams(search).keys()].map((key) => key.toLowerCase());
  return [
    ...new Set(names.filter((key) => (IDENTIFYING_PARAMS as readonly string[]).includes(key))),
  ].sort();
}

/** Removes query and fragment from the current entry (no new history entry, nothing to go back to). */
export function scrubLocation(win: Pick<Window, 'history' | 'location'> = window): void {
  win.history.replaceState(null, '', win.location.pathname);
}
