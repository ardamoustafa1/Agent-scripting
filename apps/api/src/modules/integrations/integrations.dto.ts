import { z } from 'zod';

import { IsoDateTime, ResourceMetaShape, UuidSchema, iso, isoOrNull } from '../../common/dto.js';
import { listQuerySchema, pageSchema } from '../../common/pagination/pagination.js';

import type { DataSourceRow, SecretMetadataRow } from './integrations.repository.js';

export const DataSourceSchema = z
  .object({
    ...ResourceMetaShape,
    key: z.string(),
    protocol: z.enum(['rest', 'soap', 'graphql', 'sql']),
    definition: z.unknown(),
    secretRefs: z.array(UuidSchema),
    policy: z.unknown(),
  })
  .meta({ id: 'DataSource' });
export type DataSourceDto = z.infer<typeof DataSourceSchema>;

/** Secret metadata only: ciphertext is never selected or returned (SECURITY §5.3). */
export const SecretMetadataSchema = z
  .object({
    ...ResourceMetaShape,
    name: z.string(),
    kind: z.enum(['password', 'api_key', 'oauth_client', 'certificate', 'generic']),
    keyVersion: z.number().int(),
    rotatedAt: IsoDateTime.nullable(),
    lastUsedAt: IsoDateTime.nullable(),
  })
  .meta({ id: 'SecretMetadata' });
export type SecretMetadataDto = z.infer<typeof SecretMetadataSchema>;

export const DataSourceListQuerySchema = listQuerySchema(['createdAt', 'key'], {
  protocol: z.enum(['rest', 'soap', 'graphql', 'sql']).optional(),
  q: z.string().trim().max(120).optional(),
});
export type DataSourceListQuery = z.output<typeof DataSourceListQuerySchema>;
export const SecretListQuerySchema = listQuerySchema(['createdAt', 'name'], {});
export type SecretListQuery = z.output<typeof SecretListQuerySchema>;
export const DataSourcePageSchema = pageSchema(DataSourceSchema).meta({ id: 'DataSourcePage' });
export const SecretPageSchema = pageSchema(SecretMetadataSchema).meta({ id: 'SecretMetadataPage' });

const meta = (row: { id: string; createdAt: Date; updatedAt: Date; version: number }) => ({
  id: row.id,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
  version: row.version,
});

export const toDataSourceDto = (row: DataSourceRow): DataSourceDto => ({
  ...meta(row),
  key: row.key,
  protocol: row.protocol,
  definition: row.definition,
  secretRefs: row.secretRefs,
  policy: row.policy,
});
export const toSecretDto = (row: SecretMetadataRow): SecretMetadataDto => ({
  ...meta(row),
  name: row.name,
  kind: row.kind,
  keyVersion: row.keyVersion,
  rotatedAt: isoOrNull(row.rotatedAt),
  lastUsedAt: isoOrNull(row.lastUsedAt),
});
