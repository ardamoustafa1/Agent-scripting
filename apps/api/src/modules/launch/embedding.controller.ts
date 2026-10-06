import { Controller, Get, Header, Inject, Param } from '@nestjs/common';
import { z } from 'zod';

import { Public } from '../../common/security/public.decorator.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { ApiOperation, ApiResponse, ApiTag } from '../../openapi/metadata.js';
import { TenantResolver } from '../identity/core/tenant-resolver.js';

import { frameHeaders } from './domain/frame-policy.js';

const FramePolicySchema = z
  .object({
    'content-security-policy': z.string(),
    'x-frame-options': z.literal('DENY').optional(),
  })
  .meta({ id: 'FramePolicy' });

/**
 * Frame policy for the edge that serves agent-web documents (SECURITY §4.5). Public because the
 * edge asks before any user is known; it reveals only the tenant's own public embedding hosts.
 * Unknown tenants get the deny policy (no tenant enumeration signal).
 */
@ApiTag('launch')
@Controller('v1/embedding-policy')
export class EmbeddingController {
  constructor(
    @Inject(TenantResolver) private readonly tenants: TenantResolver,
    @Inject(TenantDb) private readonly db: TenantDb,
  ) {}

  @Get(':tenant')
  @Public()
  @Header('cache-control', 'public, max-age=60')
  @ApiOperation({ summary: 'Frame-ancestors policy of a tenant for agent-web documents' })
  @ApiResponse(200, 'Headers to apply', FramePolicySchema)
  async policy(@Param('tenant') slug: string) {
    const tenant = await this.tenants.bySlug(slug);
    if (tenant?.status !== 'active') return frameHeaders(undefined);
    const row = await this.db.run(tenant.id, (tx) =>
      tx.tenant.findUnique({ where: { id: tenant.id }, select: { settings: true } }),
    );
    return frameHeaders(row?.settings);
  }
}
