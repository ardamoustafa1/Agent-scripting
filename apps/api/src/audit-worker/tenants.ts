import { z } from 'zod';

import type { PrismaService } from '../infra/database/prisma.service.js';

/** `tenants.settings.audit` — retention is a minimum (legal), never a purge order. */
export const TenantAuditSettingsSchema = z
  .object({
    audit: z
      .object({
        retentionDays: z.number().int().min(30).max(36_500).optional(),
        sessionRetentionDays: z.number().int().min(30).max(36_500).optional(),
        /** Blocks archiving-driven drops of any partition holding this tenant's rows. */
        legalHold: z.boolean().default(false),
      })
      .prefault({}),
  })
  .loose();

export interface ActiveTenant {
  readonly id: string;
  readonly retentionDays: number;
  readonly sessionRetentionDays: number;
  readonly legalHold: boolean;
}

export function parseTenantAudit(
  id: string,
  settings: unknown,
  defaultRetentionDays: number,
): ActiveTenant {
  const parsed = TenantAuditSettingsSchema.safeParse(settings ?? {});
  // Malformed settings fail safe: longest retention, legal hold on.
  if (!parsed.success)
    return { id, retentionDays: 36_500, sessionRetentionDays: 36_500, legalHold: true };
  const audit = parsed.data.audit;
  const retentionDays = audit.retentionDays ?? defaultRetentionDays;
  return {
    id,
    retentionDays,
    sessionRetentionDays: audit.sessionRetentionDays ?? retentionDays,
    legalHold: audit.legalHold,
  };
}

export async function activeTenants(
  prisma: PrismaService,
  defaultRetentionDays: number,
): Promise<ActiveTenant[]> {
  const rows = await prisma.client.$queryRaw<
    { id: string; settings: unknown }[]
  >`SELECT id, settings FROM audit_active_tenants()`;
  return rows.map((row) => parseTenantAudit(row.id, row.settings, defaultRetentionDays));
}
