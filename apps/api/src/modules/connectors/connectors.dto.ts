import { z } from 'zod';

import { ChannelTypeSchema, ResourceMetaShape, iso } from '../../common/dto.js';
import { listQuerySchema, pageSchema } from '../../common/pagination/pagination.js';

import type { ChannelRow, ConnectorRow } from './connectors.repository.js';

export const ConnectorAdapterSchema = z.enum([
  'genesys_cloud',
  'genesys_engage',
  'avaya_aes',
  'avaya_axp',
  'avaya_aacc',
  'amazon_connect',
  'cisco',
  'nice_cxone',
  'five9',
  'generic',
]);

/** Connector config may reference secrets; only non-sensitive fields are exposed. */
export const ConnectorSchema = z
  .object({
    ...ResourceMetaShape,
    adapterType: ConnectorAdapterSchema,
    platform: z.string(),
    status: z.enum(['draft', 'active', 'disabled', 'error']),
    health: z.unknown(),
  })
  .meta({ id: 'Connector' });
export type ConnectorDto = z.infer<typeof ConnectorSchema>;

export const ChannelSchema = z
  .object({
    ...ResourceMetaShape,
    type: ChannelTypeSchema,
    provider: z.string(),
    config: z.unknown(),
  })
  .meta({ id: 'Channel' });
export type ChannelDto = z.infer<typeof ChannelSchema>;

export const ConnectorListQuerySchema = listQuerySchema(['createdAt'], {
  adapterType: ConnectorAdapterSchema.optional(),
  status: z.enum(['draft', 'active', 'disabled', 'error']).optional(),
});
export type ConnectorListQuery = z.output<typeof ConnectorListQuerySchema>;
export const ChannelListQuerySchema = listQuerySchema(['createdAt'], {
  type: ChannelTypeSchema.optional(),
});
export type ChannelListQuery = z.output<typeof ChannelListQuerySchema>;
export const ConnectorPageSchema = pageSchema(ConnectorSchema).meta({ id: 'ConnectorPage' });
export const ChannelPageSchema = pageSchema(ChannelSchema).meta({ id: 'ChannelPage' });

const meta = (row: { id: string; createdAt: Date; updatedAt: Date; version: number }) => ({
  id: row.id,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
  version: row.version,
});

export const toConnectorDto = (row: ConnectorRow): ConnectorDto => ({
  ...meta(row),
  adapterType: row.adapterType,
  platform: row.platform,
  status: row.status,
  health: row.health,
});
export const toChannelDto = (row: ChannelRow): ChannelDto => ({
  ...meta(row),
  type: row.type,
  provider: row.provider,
  config: row.config,
});
