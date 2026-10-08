import { Inject, Injectable } from '@nestjs/common';

import { ScriptDocumentSchema } from '@verbis/script-schema';

import { TenantDb } from '../../infra/database/tenant-db.js';
import { AuditService } from '../audit/audit.service.js';
import { decodeDocument } from '../scripts/document-storage.js';

import { processingRows, type ProcessingRow } from './processing-record.js';

/** Bound the work of one request; the report says when it was cut. */
export const MAX_SCRIPTS = 500;

export interface ProcessingRecord {
  readonly generatedAt: string;
  readonly scripts: number;
  readonly unreadable: number;
  readonly truncated: boolean;
  readonly rows: readonly ProcessingRow[];
}

@Injectable()
export class ComplianceService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** The record covers each script's CURRENT published version only. */
  async processingRecord(format: 'csv' | 'json', now = new Date()): Promise<ProcessingRecord> {
    const tx = this.db.current(),
      tenantId = this.db.tenantId();
    const scripts = await tx.script.findMany({
      where: { tenantId, deletedAt: null, currentVersionId: { not: null } },
      select: { id: true, name: true, currentVersionId: true },
      orderBy: { id: 'asc' },
      take: MAX_SCRIPTS + 1,
    });
    const truncated = scripts.length > MAX_SCRIPTS,
      selected = scripts.slice(0, MAX_SCRIPTS);
    const versions = await tx.scriptVersion.findMany({
      where: {
        tenantId,
        state: 'published',
        id: { in: selected.flatMap((s) => (s.currentVersionId ? [s.currentVersionId] : [])) },
      },
      select: {
        id: true,
        scriptId: true,
        number: true,
        documentEncoding: true,
        document: true,
        documentCompressed: true,
      },
    });
    const byScript = new Map(versions.map((v) => [v.scriptId, v]));
    const rows: ProcessingRow[] = [];
    let unreadable = 0;
    for (const script of selected) {
      const version = byScript.get(script.id);
      if (!version) continue;
      const parsed = ScriptDocumentSchema.safeParse(await decodeDocument(version));
      if (!parsed.success) {
        unreadable += 1;
        continue;
      }
      rows.push(
        ...processingRows(
          { id: script.id, name: script.name, versionNumber: version.number },
          parsed.data,
        ),
      );
    }
    await this.audit.record(tx, {
      action: 'compliance.processingRecord.exported',
      target: { type: 'Tenant', id: tenantId },
      metadata: { format, scripts: byScript.size, rows: rows.length, unreadable, truncated },
    });
    return {
      generatedAt: now.toISOString(),
      scripts: byScript.size,
      unreadable,
      truncated,
      rows,
    };
  }
}
