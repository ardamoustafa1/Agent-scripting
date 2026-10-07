import { Controller, Get, Header, Inject, Res } from '@nestjs/common';
import { z } from 'zod';

import { ZQuery } from '../../common/validation/zod.js';
import { ApiOperation, ApiResponse, ApiTag } from '../../openapi/metadata.js';
import { Can } from '../authz/permissions.js';

import { ComplianceService } from './compliance.service.js';
import { processingCsv } from './processing-record.js';

import type { FastifyReply } from 'fastify';

const QuerySchema = z.strictObject({ format: z.enum(['csv', 'json']).default('csv') });
const RowSchema = z.object({
  scriptId: z.string(),
  scriptName: z.string(),
  versionNumber: z.number().int(),
  variable: z.string(),
  classification: z.enum(['pii', 'pci']),
  origins: z.string(),
  destinations: z.string(),
  persisted: z.boolean(),
  attention: z.boolean(),
});
const RecordSchema = z
  .object({
    generatedAt: z.iso.datetime(),
    scripts: z.number().int(),
    unreadable: z.number().int(),
    truncated: z.boolean(),
    rows: z.array(RowSchema),
  })
  .meta({ id: 'ProcessingRecord' });

@ApiTag('compliance')
@Controller('v1/compliance')
export class ComplianceController {
  constructor(@Inject(ComplianceService) private readonly compliance: ComplianceService) {}

  @ApiOperation({
    summary:
      'Record of processing derived from the published scripts (classified variables, origins, destinations); the export is audited',
  })
  @ApiResponse(200, 'Processing record (JSON) or CSV file', RecordSchema)
  @Can('export', 'Audit')
  @Header('Cache-Control', 'no-store')
  @Get('processing-record')
  async processingRecord(
    @ZQuery(QuerySchema) query: z.output<typeof QuerySchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const record = await this.compliance.processingRecord(query.format);
    if (query.format === 'json') return record;
    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="verbis-processing-record.csv"')
      .header('x-verbis-report-truncated', String(record.truncated));
    return processingCsv(record.rows);
  }
}
