import { Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { z } from 'zod';

import { requestContext } from '../../common/context/request-context.js';
import { Public } from '../../common/security/public.decorator.js';
import { ZBody } from '../../common/validation/zod.js';
import { ApiOperation, ApiResponse, ApiTag } from '../../openapi/metadata.js';

import { AuditService } from './audit.service.js';

export const CspReportSchema = z
  .object({
    'csp-report': z.object({
      'document-uri': z.string().max(2048),
      'effective-directive': z.string().regex(/^[a-z-]{1,64}$/),
      disposition: z.enum(['enforce', 'report']).optional(),
      'violated-directive': z.string().max(4096).optional(),
      'blocked-uri': z.string().max(2048).optional(),
    }),
  })
  .meta({ id: 'CspSecurityReport' });

/** Anonymous browser reports are untrusted signals, never attributed to an invented tenant. */
@ApiTag('security')
@Controller('v1/security/csp-reports')
export class SecurityReportsController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Post()
  @Public()
  @HttpCode(204)
  @ApiOperation({
    summary: 'Persist a bounded, privacy-safe browser CSP signal in the security journal',
  })
  @ApiResponse(204, 'Security signal durably acknowledged')
  async report(@ZBody(CspReportSchema) body: z.infer<typeof CspReportSchema>): Promise<void> {
    const report = body['csp-report'];
    let documentOrigin = 'opaque';
    try {
      const url = new URL(report['document-uri']);
      if (url.protocol === 'https:' || url.protocol === 'http:') documentOrigin = url.origin;
    } catch {
      /* Opaque or invalid document identifiers have no trusted origin. */
    }
    const ctx = requestContext.require();
    const id = crypto.randomUUID();
    await this.audit.recordSecurityReport({
      id,
      occurredAt: new Date().toISOString(),
      correlationId: ctx.correlationId,
      source: 'untrusted-browser-report',
      action: 'security.csp.reported',
      directive: report['effective-directive'],
      disposition: report.disposition ?? 'enforce',
      documentOrigin,
    });
  }
}
