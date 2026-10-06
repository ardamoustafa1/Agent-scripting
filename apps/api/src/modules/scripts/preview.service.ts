import { Inject, Injectable } from '@nestjs/common';

import { asSubject } from '@verbis/authz';
import { loadScriptDocument } from '@verbis/script-schema';
import type { PreviewLiveCallSchema } from '@verbis/shared-types';

import { DomainError, NotFoundError } from '../../common/errors/domain-errors.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthzService } from '../authz/authz.service.js';
import { IntegrationEngineService } from '../integrations/integration-engine.service.js';

import { decodeDocument } from './document-storage.js';
import {
  regressionResults,
  requirePassingResults,
  validateComponents,
  validateDataSourceReferences,
} from './script-validation.js';

import type { z } from 'zod';

@Injectable()
export class PreviewService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AuthzService) private readonly authz: AuthzService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(IntegrationEngineService) private readonly integrations: IntegrationEngineService,
  ) {}
  private async document(scriptId: string, number: number) {
    const tx = this.db.current();
    const row = await tx.scriptVersion.findFirst({
      where: { tenantId: this.db.tenantId(), scriptId, number, deletedAt: null },
    });
    if (!row) throw new NotFoundError('ScriptVersion');
    const campaigns = await tx.assignment.findMany({
      where: { tenantId: this.db.tenantId(), scriptId, deletedAt: null },
      select: { campaignId: true },
      distinct: ['campaignId'],
    });
    this.authz.authorize(
      'read',
      asSubject('Script', { id: scriptId, campaignIds: campaigns.map((c) => c.campaignId) }),
    );
    const loaded = loadScriptDocument(await decodeDocument(row));
    if (!loaded.ok) throw new DomainError('VERBIS_SCRIPT_DOCUMENT_INVALID');
    return { row, document: loaded.document };
  }
  async regression(scriptId: string, number: number) {
    const { row, document } = await this.document(scriptId, number);
    const results = await regressionResults(document);
    const report = {
      checksum: row.checksum,
      version: row.version,
      passed: results.length > 0 && results.every((r) => r.passed),
      checkedAt: new Date().toISOString(),
      results,
    };
    await this.audit.record(this.db.current(), {
      action: 'script.version.regressionChecked',
      target: { type: 'ScriptVersion', id: row.id },
      outcome: report.passed ? 'success' : 'failure',
      metadata: {
        checksum: row.checksum,
        count: results.length,
        passed: results.filter((r) => r.passed).length,
      },
    });
    return report;
  }
  async requirePassing(scriptId: string, number: number) {
    const { document } = await this.document(scriptId, number);
    // Validate the whole document even when scenarios are empty or skip a broken page.
    validateComponents(document);
    await validateDataSourceReferences(this.db.current(), this.db.tenantId(), document, true);
    const report = await this.regression(scriptId, number);
    requirePassingResults(report.results);
    return report;
  }
  async live(
    scriptId: string,
    number: number,
    dataSource: string,
    call: z.infer<typeof PreviewLiveCallSchema>,
  ) {
    const { document } = await this.document(scriptId, number);
    const reference = document.dataSources.find((source) => source.id === dataSource);
    if (!reference) throw new NotFoundError('DataSource');
    return this.integrations.previewRuntimeCall(reference.ref, reference.version, call);
  }
}
