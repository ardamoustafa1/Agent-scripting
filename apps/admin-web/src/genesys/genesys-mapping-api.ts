import { z } from 'zod';

/**
 * Genesys Cloud queue / outbound campaign → Verbis campaign bindings. Stored as campaign
 * `externalMappings` (platform `genesys-cloud`, kind `queue` | `campaign`) through the BFF with
 * optimistic locking; the API enforces one owner per Genesys object and audits the update.
 */
export const GENESYS_PLATFORM = 'genesys-cloud';
export const MAPPING_KINDS = ['queue', 'campaign'] as const;
export type MappingKind = (typeof MAPPING_KINDS)[number];

const MappingSchema = z.object({ platform: z.string(), kind: z.string(), externalId: z.string() });
export type ExternalMapping = z.infer<typeof MappingSchema>;
const CampaignSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.number().int(),
  externalMappings: z.array(MappingSchema),
});
export type CampaignSummary = z.infer<typeof CampaignSchema>;
const PageSchema = z.object({ data: z.array(CampaignSchema) });

export const GenesysIdSchema = z.uuid();

export class MappingApiError extends Error {
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
    throw new MappingApiError(problem.success ? problem.data.code : 'VERBIS_HTTP_UNAVAILABLE');
  }
  return response.json().catch(() => null);
}

export async function listCampaigns(): Promise<CampaignSummary[]> {
  return PageSchema.parse(await call('/v1/campaigns?limit=100')).data;
}

export function genesysMappings(campaign: CampaignSummary): ExternalMapping[] {
  return campaign.externalMappings.filter((m) => m.platform === GENESYS_PLATFORM);
}

/** Next mapping list for one platform: others untouched; add or remove one binding. */
export function nextMappingsFor(
  campaign: CampaignSummary,
  platform: string,
  idSchema: z.ZodType<string>,
  change: { add?: { kind: string; externalId: string }; remove?: ExternalMapping },
): ExternalMapping[] {
  const kept = campaign.externalMappings.filter(
    (m) =>
      change.remove === undefined ||
      !(
        m.platform === change.remove.platform &&
        m.kind === change.remove.kind &&
        m.externalId === change.remove.externalId
      ),
  );
  if (change.add === undefined) return kept;
  const externalId = idSchema.parse(change.add.externalId);
  if (
    kept.some(
      (m) => m.platform === platform && m.kind === change.add?.kind && m.externalId === externalId,
    )
  )
    return kept;
  return [...kept, { platform, kind: change.add.kind, externalId }];
}

/** Genesys Cloud ids are UUIDs (normalized to lower case). */
export function nextMappings(
  campaign: CampaignSummary,
  change: { add?: { kind: MappingKind; externalId: string }; remove?: ExternalMapping },
): ExternalMapping[] {
  return nextMappingsFor(
    campaign,
    GENESYS_PLATFORM,
    z.string().trim().toLowerCase().pipe(GenesysIdSchema),
    change,
  );
}

export async function saveMappings(
  campaign: CampaignSummary,
  externalMappings: ExternalMapping[],
  csrfToken: string,
): Promise<void> {
  await call(`/v1/campaigns/${campaign.id}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': csrfToken,
      'if-match': `"${String(campaign.version)}"`,
    },
    body: JSON.stringify({ externalMappings }),
  });
}
