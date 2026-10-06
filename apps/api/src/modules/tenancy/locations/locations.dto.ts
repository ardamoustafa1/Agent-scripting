import { z } from 'zod';

import { ResourceMetaShape, iso } from '../../../common/dto.js';
import { listQuerySchema, pageSchema } from '../../../common/pagination/pagination.js';

const CodeSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase kebab-case')
  .max(64)
  .meta({ description: 'Stable kebab-case identifier; immutable after creation' });
const NameSchema = z.string().trim().min(1).max(200);

export const LocationSchema = z
  .object({ ...ResourceMetaShape, code: CodeSchema, name: NameSchema })
  .meta({ id: 'Location' });
export type LocationDto = z.infer<typeof LocationSchema>;

export const CreateLocationSchema = z
  .strictObject({ code: CodeSchema, name: NameSchema })
  .meta({ id: 'CreateLocation' });
export type CreateLocationInput = z.output<typeof CreateLocationSchema>;

export const UpdateLocationSchema = z
  .strictObject({ name: NameSchema })
  .meta({ id: 'UpdateLocation' });
export type UpdateLocationInput = z.output<typeof UpdateLocationSchema>;

export const LocationListQuerySchema = listQuerySchema(['createdAt', 'name'], {
  q: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .meta({ description: 'Case-insensitive name or code contains' }),
});
export type LocationListQuery = z.output<typeof LocationListQuerySchema>;
export const LocationPageSchema = pageSchema(LocationSchema).meta({ id: 'LocationPage' });

export interface LocationRow {
  id: string;
  code: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}
export function toLocationDto(row: LocationRow): LocationDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    version: row.version,
  };
}
