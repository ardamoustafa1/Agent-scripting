import { z } from 'zod';

/**
 * Genesys Cloud regions (source: platform-client-sdk `PureCloudRegionHosts`, checked 2026-10-01).
 * Every host is derived from this allow-list — never from tenant input — so an admin cannot point
 * the hub or the API at an arbitrary host (SSRF).
 */
export const GENESYS_CLOUD_REGIONS = {
  'us-east-1': 'mypurecloud.com',
  'us-east-2': 'use2.us-gov-pure.cloud',
  'us-west-2': 'usw2.pure.cloud',
  'ca-central-1': 'cac1.pure.cloud',
  'sa-east-1': 'sae1.pure.cloud',
  'mx-central-1': 'mxc1.pure.cloud',
  'eu-central-1': 'mypurecloud.de',
  'eu-central-2': 'euc2.pure.cloud',
  'eu-west-1': 'mypurecloud.ie',
  'eu-west-2': 'euw2.pure.cloud',
  'eusc-de-east-1': 'edee1.eusc-pure.cloud',
  'me-central-1': 'mec1.pure.cloud',
  'ap-south-1': 'aps1.pure.cloud',
  'ap-southeast-1': 'apse1.pure.cloud',
  'ap-southeast-2': 'mypurecloud.com.au',
  'ap-northeast-1': 'mypurecloud.jp',
  'ap-northeast-2': 'apne2.pure.cloud',
  'ap-northeast-3': 'apne3.pure.cloud',
} as const;
export type GenesysCloudRegion = keyof typeof GENESYS_CLOUD_REGIONS;

const DOMAINS = Object.values(GENESYS_CLOUD_REGIONS) as readonly string[];

/** Accepts a region key (`eu-central-1`) or its domain (`mypurecloud.de`, the widget's `gcTargetEnv`). */
export const GenesysCloudRegionSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value, ctx) => {
    if (value in GENESYS_CLOUD_REGIONS) return value as GenesysCloudRegion;
    const key = (Object.keys(GENESYS_CLOUD_REGIONS) as GenesysCloudRegion[]).find(
      (k) => GENESYS_CLOUD_REGIONS[k] === value,
    );
    if (key !== undefined) return key;
    ctx.addIssue({ code: 'custom', message: 'unknown Genesys Cloud region' });
    return z.NEVER;
  });

export interface GenesysCloudHosts {
  readonly domain: string;
  /** `https://api.<domain>` — Platform API. */
  readonly api: string;
  /** `https://login.<domain>` — OAuth authorize/token. */
  readonly login: string;
  /** `wss://streaming.<domain>` — Notifications WebSocket host (connectUri must match it). */
  readonly streaming: string;
  /** `https://apps.<domain>` — Genesys Cloud UI origin hosting the Interaction Widget. */
  readonly apps: string;
}

export function genesysCloudHosts(region: GenesysCloudRegion): GenesysCloudHosts {
  const domain = GENESYS_CLOUD_REGIONS[region];
  return {
    domain,
    api: `https://api.${domain}`,
    login: `https://login.${domain}`,
    streaming: `wss://streaming.${domain}`,
    apps: `https://apps.${domain}`,
  };
}

/** True when `url` is a WebSocket URL on the region's streaming host (validates `connectUri`). */
export function isGenesysStreamingUrl(region: GenesysCloudRegion, url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'wss:' && parsed.host === `streaming.${GENESYS_CLOUD_REGIONS[region]}`
    );
  } catch {
    return false;
  }
}

export function isGenesysCloudDomain(value: string): boolean {
  return DOMAINS.includes(value);
}
