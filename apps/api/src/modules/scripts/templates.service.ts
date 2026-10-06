import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import {
  minimalScript,
  collectionsScript,
  creditCardSalesScript,
  surveyScript,
  telecomTariffChangeScript,
} from '@verbis/script-schema/templates';

import { currentActor } from '../../common/actor.js';
import { canonicalJson, sha256Hex } from '../../common/crypto/canonical-json.js';
import { ConflictError, NotFoundError } from '../../common/errors/domain-errors.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { AuditService } from '../audit/audit.service.js';

import { decodeDocument } from './document-storage.js';
import { ScriptsService } from './scripts.service.js';

import type { Prisma } from '../../generated/prisma/client.js';

export const TEMPLATE_CATEGORIES = [
  'sales',
  'service',
  'collections',
  'survey',
  'retention',
  'onboarding',
  'other',
] as const;

export const CreateTemplateSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(120),
    category: z.enum(TEMPLATE_CATEGORIES),
    description: z.string().trim().max(2000).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    /** Source: a script version (kind `script`). */
    scriptId: z.uuid(),
    versionNumber: z.number().int().positive(),
  })
  .meta({ id: 'CreateTemplate' });
export type CreateTemplateInput = z.output<typeof CreateTemplateSchema>;

export const InstantiateTemplateSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).optional(),
  })
  .meta({ id: 'InstantiateTemplate' });

function sectorTemplate(sector: 'insurance' | 'ecommerce') {
  const document = minimalScript();
  const insurance = sector === 'insurance';
  document.meta.name = insurance ? 'Insurance renewal' : 'E-commerce order support';
  document.variables = [{ key: 'reference', type: 'string', scope: 'session', default: '' }];
  const root = document.pages[0]?.layout;
  if (root)
    root.children = [
      { id: 'greeting', type: 'scriptText', props: { textKey: 'sector.greeting' } },
      {
        id: 'reference',
        type: 'textInput',
        props: { labelKey: 'sector.reference' },
        bindings: [{ prop: 'value', variable: 'reference' }],
      },
      { id: 'legal', type: 'scriptText', props: { textKey: 'sector.legal', mustRead: true } },
      {
        id: 'btn-next',
        type: 'button',
        props: { labelKey: 'common.next' },
        events: { onPress: [{ type: 'validatePage' }, { type: 'next' }] },
      },
    ];
  document.i18n.messages = {
    tr: {
      'common.next': 'Tamamla',
      'sector.greeting': insurance
        ? 'Yenileme seçeneklerini ve teminat ihtiyaçlarınızı birlikte gözden geçirelim.'
        : 'Siparişinizle ilgili talebinizi birlikte çözelim.',
      'sector.reference': insurance ? 'Poliçe referansı' : 'Sipariş referansı',
      'sector.legal': insurance
        ? 'Teklif, kapsam ve istisnaları doğrulayarak müşteriye açıklayın.'
        : 'Kimliği doğrulayın; iade, teslimat ve kişisel veri süreçlerini müşteriye açıklayın.',
    },
    en: {
      'common.next': 'Complete',
      'sector.greeting': insurance
        ? 'Let us review renewal options and coverage needs together.'
        : 'Let us resolve your order request together.',
      'sector.reference': insurance ? 'Policy reference' : 'Order reference',
      'sector.legal': insurance
        ? 'Verify and explain the quote, coverage and exclusions.'
        : 'Verify identity; explain returns, delivery and personal data handling.',
    },
  };
  return document;
}

/** Curated starting points shipped with the product (read-only, versioned with the release). */
const BUILT_IN = [
  {
    id: 'builtin-credit-card-sales',
    name: 'Credit card sales',
    category: 'sales',
    document: creditCardSalesScript,
  },
  {
    id: 'builtin-telecom-tariff-change',
    name: 'Telecom tariff change',
    category: 'retention',
    document: telecomTariffChangeScript,
  },
  {
    id: 'builtin-collections',
    name: 'Collections (right-party contact)',
    category: 'collections',
    document: collectionsScript,
  },
  {
    id: 'builtin-insurance-renewal',
    name: 'Insurance renewal',
    category: 'service',
    document: sectorTemplate('insurance'),
  },
  {
    id: 'builtin-ecommerce-order',
    name: 'E-commerce order support',
    category: 'service',
    document: sectorTemplate('ecommerce'),
  },
  { id: 'builtin-nps-survey', name: 'NPS survey', category: 'survey', document: surveyScript },
] as const;

@Injectable()
export class TemplatesService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ScriptsService) private readonly scripts: ScriptsService,
  ) {}

  async list(filters: { category?: string; q?: string }) {
    const rows = await this.db.current().template.findMany({
      where: {
        tenantId: this.db.tenantId(),
        deletedAt: null,
        ...(filters.category === undefined ? {} : { category: filters.category }),
        ...(filters.q === undefined ? {} : { name: { contains: filters.q, mode: 'insensitive' } }),
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        kind: true,
        name: true,
        category: true,
        description: true,
        tags: true,
        locale: true,
        checksum: true,
        createdAt: true,
      },
    });
    const builtIn = BUILT_IN.filter(
      (t) =>
        (filters.category === undefined || t.category === filters.category) &&
        (filters.q === undefined || t.name.toLowerCase().includes(filters.q.toLowerCase())),
    ).map((t) => ({
      id: t.id,
      kind: 'script',
      name: t.name,
      category: t.category,
      description: null,
      tags: [
        t.id.includes('credit-card')
          ? 'banking'
          : t.id.includes('telecom')
            ? 'telecom'
            : t.id.includes('insurance')
              ? 'insurance'
              : t.id.includes('ecommerce')
                ? 'ecommerce'
                : t.id.includes('collections')
                  ? 'collections'
                  : 'survey',
      ],
      locale: null,
      checksum: sha256Hex(canonicalJson(t.document)),
      builtIn: true,
    }));
    return [
      ...builtIn,
      ...rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), builtIn: false })),
    ];
  }

  async create(input: CreateTemplateInput) {
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    await this.scripts.authorizeRead(input.scriptId);
    const version = await tx.scriptVersion.findFirst({
      where: { tenantId, scriptId: input.scriptId, number: input.versionNumber, deletedAt: null },
      select: {
        id: true,
        documentEncoding: true,
        document: true,
        documentCompressed: true,
        checksum: true,
      },
    });
    if (version === null) throw new NotFoundError('Script version');
    if (
      (await tx.template.count({
        where: { tenantId, kind: 'script', name: input.name, deletedAt: null },
      })) > 0
    ) {
      throw new ConflictError('A template with this name exists');
    }
    const document = await decodeDocument(version);
    const id = crypto.randomUUID();
    const actor = currentActor();
    await tx.template.create({
      data: {
        id,
        tenantId,
        kind: 'script',
        name: input.name,
        category: input.category,
        description: input.description ?? null,
        tags: input.tags,
        document: document as Prisma.InputJsonValue,
        checksum: version.checksum,
        sourceVersionId: version.id,
        createdBy: actor,
        updatedBy: actor,
      },
    });
    await this.audit.record(tx, {
      action: 'script.template.created',
      target: { type: 'Template', id, name: input.name },
      after: { category: input.category, sourceVersionId: version.id, checksum: version.checksum },
    });
    return { id, name: input.name, category: input.category, checksum: version.checksum };
  }

  /** New script + draft version from a template (built-in or tenant). */
  async instantiate(templateId: string, input: { name: string; description?: string | undefined }) {
    const builtIn = BUILT_IN.find((t) => t.id === templateId);
    let document: Record<string, unknown>;
    if (builtIn !== undefined) document = structuredClone(builtIn.document);
    else {
      const row = await this.db.current().template.findFirst({
        where: { id: templateId, tenantId: this.db.tenantId(), deletedAt: null },
        select: { document: true },
      });
      if (row === null) throw new NotFoundError('Template');
      document = row.document as Record<string, unknown>;
    }
    const meta = { ...((document['meta'] ?? {}) as Record<string, unknown>), name: input.name };
    const script = await this.scripts.create({
      name: input.name,
      tags: [],
      ...(input.description === undefined ? {} : { description: input.description }),
    });
    const version = await this.scripts.createVersion(
      script.id,
      { document: { ...document, meta }, screens: [] },
      { source: { templateId } },
    );
    await this.audit.record(this.db.current(), {
      action: 'script.template.instantiated',
      target: { type: 'Template', id: templateId },
      metadata: { scriptId: script.id, versionId: version.id },
    });
    return { script, version };
  }
}
