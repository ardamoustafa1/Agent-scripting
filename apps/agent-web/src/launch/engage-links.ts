import { z } from 'zod';

/** Genesys Engage delegated links of the signed-in agent (ADR-0019). Through the BFF only. */
export const EngageLinkStatusSchema = z.array(
  z.object({ connectorId: z.uuid(), linked: z.boolean(), expiresAt: z.string().nullable() }),
);
export type EngageLinkStatus = z.infer<typeof EngageLinkStatusSchema>;

export async function fetchEngageLinks(): Promise<EngageLinkStatus> {
  const response = await fetch('/api/v1/genesys-engage/links', {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) return [];
  const parsed = EngageLinkStatusSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data : [];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function engageAuthorizePath(connectorId: string): string {
  if (!UUID.test(connectorId)) throw new Error('invalid connector id');
  return `/api/v1/genesys-engage/connectors/${connectorId}/oauth/authorize`;
}

export function openEngageLinkPopup(
  connectorId: string,
  win: Pick<Window, 'open'> = window,
): Window | null {
  return win.open(
    engageAuthorizePath(connectorId),
    'verbis-genesys-link',
    'popup,width=520,height=720',
  );
}
