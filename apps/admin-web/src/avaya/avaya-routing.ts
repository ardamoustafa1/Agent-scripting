import { z } from 'zod';

import {
  nextMappingsFor,
  type CampaignSummary,
  type ExternalMapping,
} from '../genesys/genesys-mapping-api.js';

/** Avaya routing objects per platform (campaign external mappings; docs/connectors/avaya.md). */
export const AVAYA_PLATFORMS = {
  'avaya-aes': ['vdn', 'skill', 'campaign'],
  'avaya-aacc': ['skillset', 'vdn', 'campaign'],
  'avaya-axp': ['queue', 'campaign'],
} as const;
export type AvayaPlatform = keyof typeof AVAYA_PLATFORMS;
export type AvayaKind = (typeof AVAYA_PLATFORMS)[AvayaPlatform][number];

/** VDN / skill numbers, AACC skillset names, AXP queue ids, POM campaign names. */
export const AvayaIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_.:-]{1,64}$/);

export function avayaMappings(campaign: CampaignSummary): ExternalMapping[] {
  return campaign.externalMappings.filter((m) => m.platform in AVAYA_PLATFORMS);
}

export function nextAvayaMappings(
  campaign: CampaignSummary,
  platform: AvayaPlatform,
  change: { add?: { kind: string; externalId: string }; remove?: ExternalMapping },
): ExternalMapping[] {
  if (
    change.add !== undefined &&
    !(AVAYA_PLATFORMS[platform] as readonly string[]).includes(change.add.kind)
  )
    throw new Error('kind not valid for platform');
  return nextMappingsFor(campaign, platform, AvayaIdSchema, change);
}
