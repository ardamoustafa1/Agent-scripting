import { z } from 'zod';

export const normalizeCtiPlatform = (platform: string): string =>
  platform
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '-');

export const CtiIdentitySchema = z.strictObject({
  platform: z.string().trim().min(1).max(64).transform(normalizeCtiPlatform),
  id: z.string().min(1).max(256),
});
/** Legacy admin payloads/rows remain readable; all writes use { platform, id }. */
export const CtiIdentityInputSchema = z.union([
  CtiIdentitySchema,
  CtiIdentitySchema.omit({ id: true })
    .extend({ platformUserId: CtiIdentitySchema.shape.id })
    .transform(({ platform, platformUserId }) => ({ platform, id: platformUserId })),
]);
export const CtiIdentitiesSchema = z.array(CtiIdentityInputSchema);
