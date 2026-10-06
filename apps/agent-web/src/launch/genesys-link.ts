/**
 * Genesys Cloud account link (docs/connectors/genesys-cloud.md §Identity). The Interaction
 * Widget iframe opens a first-party popup on this origin; the BFF runs Authorization Code + PKCE
 * and redirects the popup to `/genesys/linked#status=…`, which reports back to the opener with a
 * same-origin `postMessage` and closes. No token or code ever reaches this app.
 */
export const LINKED_PATH = '/genesys/linked';
export const LINK_MESSAGE = 'verbis.genesys.linked';
export type LinkStatus = 'linked' | 'failed';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function authorizePath(connectorId: string): string {
  if (!UUID.test(connectorId)) throw new Error('invalid connector id');
  return `/api/v1/genesys-cloud/connectors/${connectorId}/oauth/authorize`;
}

export function openLinkPopup(
  connectorId: string,
  win: Pick<Window, 'open'> = window,
): Window | null {
  return win.open(authorizePath(connectorId), 'verbis-genesys-link', 'popup,width=520,height=720');
}

export function parseLinkStatus(hash: string): LinkStatus {
  return new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash).get('status') === 'linked'
    ? 'linked'
    : 'failed';
}

/** Accepts only same-origin messages of the expected shape. */
export function linkStatusFrom(
  event: Pick<MessageEvent, 'origin' | 'data'>,
  origin: string,
): LinkStatus | undefined {
  if (event.origin !== origin) return undefined;
  const data = event.data as { type?: unknown; status?: unknown } | null;
  if (data?.type !== LINK_MESSAGE) return undefined;
  return data.status === 'linked' ? 'linked' : 'failed';
}
