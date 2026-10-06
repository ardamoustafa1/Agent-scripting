import { z } from 'zod';

/** Shared DTO building blocks. */
export const UuidSchema = z.uuid().meta({ description: 'UUIDv7 identifier' });
export const IsoDateTime = z.iso.datetime({ offset: true });

export const iso = (date: Date): string => date.toISOString();
export const isoOrNull = (date: Date | null): string | null =>
  date === null ? null : date.toISOString();

/** Columns every tenant-owned resource exposes. */
export const ResourceMetaShape = {
  id: UuidSchema,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  version: z
    .number()
    .int()
    .positive()
    .meta({ description: 'Optimistic-lock version; send as If-Match: "<version>"' }),
};

export const ChannelTypeSchema = z.enum([
  'voice',
  'chat',
  'email',
  'sms',
  'whatsapp',
  'social',
  'video',
  'callback',
]);
