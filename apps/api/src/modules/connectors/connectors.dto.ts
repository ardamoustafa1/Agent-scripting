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
    /** Non-secret flavour label of a generic connector (e.g. `simulator`); the rest of `config` stays private. */
    kind: z.string().max(64).optional(),
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

const KIND_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
/** Only a short lowercase label is exposed from `config`; it can never carry a secret reference. */
export const publicConnectorKind = (config: unknown): string | undefined => {
  const kind = (config as { kind?: unknown } | null | undefined)?.kind;
  return typeof kind === 'string' && KIND_PATTERN.test(kind) ? kind : undefined;
};
export const toConnectorDto = (row: ConnectorRow): ConnectorDto => {
  const kind = publicConnectorKind(row.config);
  return {
    ...meta(row),
    adapterType: row.adapterType,
    platform: row.platform,
    status: row.status,
    health: row.health,
    ...(kind === undefined ? {} : { kind }),
  };
};
export const toChannelDto = (row: ChannelRow): ChannelDto => ({
  ...meta(row),
  type: row.type,
  provider: row.provider,
  config: row.config,
});
