import { describe, expect, it } from 'vitest';

import {
  GENESYS_CLOUD_REGIONS,
  GenesysCloudRegionSchema,
  genesysCloudHosts,
  isGenesysStreamingUrl,
} from './genesys-cloud.js';

describe('genesys cloud regions', () => {
  it('accepts region keys and domains, refuses anything else', () => {
    expect(GenesysCloudRegionSchema.parse('eu-central-1')).toBe('eu-central-1');
    expect(GenesysCloudRegionSchema.parse('mypurecloud.de')).toBe('eu-central-1');
    expect(GenesysCloudRegionSchema.parse(' MyPureCloud.IE ')).toBe('eu-west-1');
    for (const bad of ['evil.example', 'mypurecloud.de.evil.example', '', 'api.mypurecloud.com'])
      expect(GenesysCloudRegionSchema.safeParse(bad).success).toBe(false);
  });

  it('derives api/login/streaming/apps hosts for every region', () => {
    for (const region of Object.keys(
      GENESYS_CLOUD_REGIONS,
    ) as (keyof typeof GENESYS_CLOUD_REGIONS)[]) {
      const hosts = genesysCloudHosts(region);
      expect(hosts.api).toBe(`https://api.${GENESYS_CLOUD_REGIONS[region]}`);
      expect(hosts.login).toMatch(/^https:\/\/login\./);
    }
    expect(genesysCloudHosts('ap-southeast-2').api).toBe('https://api.mypurecloud.com.au');
    expect(genesysCloudHosts('ap-northeast-1').login).toBe('https://login.mypurecloud.jp');
  });

  it('only trusts connectUri on the region streaming host', () => {
    expect(
      isGenesysStreamingUrl('eu-central-1', 'wss://streaming.mypurecloud.de/channels/abc'),
    ).toBe(true);
    expect(
      isGenesysStreamingUrl('eu-central-1', 'wss://streaming.mypurecloud.com/channels/abc'),
    ).toBe(false);
    expect(
      isGenesysStreamingUrl('eu-central-1', 'ws://streaming.mypurecloud.de/channels/abc'),
    ).toBe(false);
    expect(isGenesysStreamingUrl('eu-central-1', 'not a url')).toBe(false);
  });
});
