import { z } from 'zod';

import { ResourceMetaShape, UuidSchema, iso } from '../../common/dto.js';
import { listQuerySchema, pageSchema } from '../../common/pagination/pagination.js';

import type { ScreenRow, ScreenWithComponentsRow } from './screens.repository.js';

export const ScreenSchema = z
  .object({
    ...ResourceMetaShape,
    scriptVersionId: UuidSchema,
    key: z.string(),
    title: z.string().nullable(),
    entry: z.boolean(),
  })
  .meta({ id: 'Screen' });
export type ScreenDto = z.infer<typeof ScreenSchema>;

export const ComponentSchema = z
  .object({
    id: UuidSchema,
    key: z.string(),
    type: z.string(),
    props: z.unknown(),
    bindings: z.unknown(),
    events: z.unknown(),
  })
  .meta({ id: 'Component' });

export const ScreenDetailSchema = ScreenSchema.extend({
  layoutRoot: z.unknown(),
  components: z.array(ComponentSchema),
}).meta({ id: 'ScreenDetail' });
export type ScreenDetailDto = z.infer<typeof ScreenDetailSchema>;

export const ScreenListQuerySchema = listQuerySchema(
  ['key', 'createdAt'],
  {
    entry: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
  },
  'key',
);
export type ScreenListQuery = z.output<typeof ScreenListQuerySchema>;
export const ScreenPageSchema = pageSchema(ScreenSchema).meta({ id: 'ScreenPage' });

export const toScreenDto = (row: ScreenRow): ScreenDto => ({
  id: row.id,
  scriptVersionId: row.scriptVersionId,
  key: row.key,
  title: row.title,
  entry: row.entry,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
  version: row.version,
});

export const toScreenDetailDto = (row: ScreenWithComponentsRow): ScreenDetailDto => ({
  ...toScreenDto(row),
  layoutRoot: row.layoutRoot,
  components: row.components.map((component) => ({
    id: component.id,
    key: component.key,
    type: component.type,
    props: component.props,
    bindings: component.bindings,
    events: component.events,
  })),
});
