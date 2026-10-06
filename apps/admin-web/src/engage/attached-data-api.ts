import { z } from 'zod';

/** Attached data → script variable map of Genesys Engage connectors (BFF, If-Match, audited). */
export const MAPPING_TYPES = ['string', 'number', 'boolean'] as const;
export const MappingSchema = z.object({
  key: z.string().regex(/^[A-Za-z0-9_.:\- ]{1,128}$/),
  variable: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/),
  type: z.enum(MAPPING_TYPES),
  writeBack: z.boolean(),
  pii: z.boolean(),
});
export type Mapping = z.infer<typeof MappingSchema>;
const MapSchema = z.object({
  connectorId: z.string(),
  version: z.number().int(),
  attachedData: z.array(MappingSchema),
});
export type AttachedDataMap = z.infer<typeof MapSchema>;
const ConnectorPageSchema = z.object({
  data: z.array(z.object({ id: z.string(), adapterType: z.string(), status: z.string() })),
});

export class AttachedDataApiError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

async function call(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...init,
    headers: (() => {
      const headers = new Headers(init.headers);
      if (!headers.has('accept')) headers.set('accept', 'application/json');
      return headers;
    })(),
  });
  if (!response.ok) {
    const problem = z
      .object({ code: z.string() })
      .safeParse(await response.json().catch(() => null));
    throw new AttachedDataApiError(problem.success ? problem.data.code : 'VERBIS_HTTP_UNAVAILABLE');
  }
  return response.json().catch(() => null);
}

export async function listEngageConnectors(): Promise<string[]> {
  const page = ConnectorPageSchema.parse(await call('/v1/connectors?limit=100'));
  return page.data
    .filter((c) => c.adapterType === 'genesys_engage' && c.status !== 'disabled')
    .map((c) => c.id);
}

export async function getMap(connectorId: string): Promise<AttachedDataMap> {
  return MapSchema.parse(await call(`/v1/connectors/${connectorId}/attached-data-map`));
}

export async function saveMap(map: AttachedDataMap, csrfToken: string): Promise<AttachedDataMap> {
  return MapSchema.parse(
    await call(`/v1/connectors/${map.connectorId}/attached-data-map`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrfToken,
        'if-match': `"${String(map.version)}"`,
      },
      body: JSON.stringify({ attachedData: map.attachedData }),
    }),
  );
}

/** Client-side check mirroring the server (unique keys and variables, grammar). */
export function validateRows(rows: readonly Mapping[]): 'ok' | 'invalid' | 'duplicate' {
  if (rows.some((r) => !MappingSchema.safeParse(r).success)) return 'invalid';
  if (
    new Set(rows.map((r) => r.key)).size !== rows.length ||
    new Set(rows.map((r) => r.variable)).size !== rows.length
  )
    return 'duplicate';
  return 'ok';
}
