import { X509Certificate } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { currentActor } from '../../../common/actor.js';
import { requestContext } from '../../../common/context/request-context.js';
import { ResourceMetaShape } from '../../../common/dto.js';
import {
  DomainError,
  ForbiddenError,
  NotFoundError,
  VersionMismatchError,
} from '../../../common/errors/domain-errors.js';
import { TenantDb } from '../../../infra/database/tenant-db.js';
import { AuditService } from '../../audit/audit.service.js';
import { parseRequirement } from '../../authz/permissions.js';
import { randomToken, sha256Base64Url, sha256Hex } from '../crypto/random.js';

const Scope = z
  .string()
  .max(128)
  .refine((value) => parseRequirement(value) !== undefined, 'Unknown permission scope');

export const CreateServiceClientSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(128),
    authMethod: z
      .enum(['client_secret_basic', 'client_secret_post', 'tls_client_auth'])
      .default('client_secret_basic'),
    scopes: z.array(Scope).min(1).max(50),
    /** PEM client certificate for tls_client_auth, or to bind secret-based tokens (RFC 8705). */
    certificate: z.string().max(16_384).optional(),
  })
  .meta({ id: 'CreateServiceClient' });
export type CreateServiceClientInput = z.output<typeof CreateServiceClientSchema>;

export const UpdateServiceClientSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(128).optional(),
    scopes: z.array(Scope).min(1).max(50).optional(),
    status: z.enum(['active', 'disabled']).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'at least one field is required')
  .meta({ id: 'UpdateServiceClient' });

export const ServiceClientSchema = z
  .object({
    ...ResourceMetaShape,
    clientId: z.uuid(),
    name: z.string(),
    authMethod: z.enum(['client_secret_basic', 'client_secret_post', 'tls_client_auth']),
    scopes: z.array(z.string()),
    status: z.enum(['active', 'disabled']),
    certificateThumbprint: z.string().nullable(),
    lastUsedAt: z.string().nullable(),
    tokenEndpoint: z.string(),
  })
  .meta({ id: 'ServiceClient' });
export const ServiceClientWithSecretSchema = ServiceClientSchema.extend({
  clientSecret: z.string().nullable().meta({ description: '@secret shown once' }),
}).meta({ id: 'ServiceClientWithSecret' });

interface Row {
  id: string;
  name: string;
  authMethod: 'client_secret_basic' | 'client_secret_post' | 'tls_client_auth';
  scopes: string[];
  status: 'active' | 'disabled';
  certificateThumbprint: string | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

/** Service clients for the client-credentials grant; secrets are generated and shown once. */
@Injectable()
export class ServiceClientsService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private async tokenEndpoint(): Promise<string> {
    const tenant = await this.db
      .current()
      .tenant.findFirst({ where: { id: this.db.tenantId() }, select: { slug: true } });
    return `/oauth2/${tenant?.slug ?? ''}/token`;
  }

  private async view(row: Row) {
    return {
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      version: row.version,
      clientId: row.id,
      name: row.name,
      authMethod: row.authMethod,
      scopes: row.scopes,
      status: row.status,
      certificateThumbprint: row.certificateThumbprint,
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      tokenEndpoint: await this.tokenEndpoint(),
    };
  }

  /** An admin can only delegate permissions it holds itself (no escalation through clients). */
  private assertDelegable(scopes: readonly string[]): void {
    const ability = requestContext.require().authz?.ability;
    const holds = (scope: string): boolean => {
      const parsed = parseRequirement(scope);
      return (
        ability !== undefined &&
        parsed !== undefined &&
        ability.can(parsed.action, parsed.subject) &&
        ability
          .possibleRulesFor(parsed.action, parsed.subject)
          .some(
            (rule) => !rule.inverted && rule.conditions === undefined && rule.fields === undefined,
          ) &&
        !ability
          .possibleRulesFor(parsed.action, parsed.subject)
          .some(
            (rule) => rule.inverted && (rule.conditions !== undefined || rule.fields !== undefined),
          )
      );
    };
    if (!scopes.every(holds)) {
      throw new ForbiddenError('A service client cannot receive permissions you do not hold');
    }
  }

  async list() {
    const rows = await this.db.current().serviceClient.findMany({
      where: { tenantId: this.db.tenantId(), deletedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return Promise.all(rows.map((row) => this.view(row)));
  }

  async get(id: string) {
    return this.view(await this.find(id));
  }

  async create(input: CreateServiceClientInput) {
    this.assertDelegable(input.scopes);
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    let thumbprint: string | null = null;
    if (input.certificate !== undefined) {
      try {
        thumbprint = sha256Base64Url(new X509Certificate(input.certificate).raw);
      } catch {
        throw new DomainError(
          'VERBIS_VALIDATION_FAILED',
          'certificate must be a PEM X.509 certificate',
        );
      }
    }
    if (input.authMethod === 'tls_client_auth' && thumbprint === null) {
      throw new DomainError('VERBIS_VALIDATION_FAILED', 'tls_client_auth requires a certificate');
    }
    const secret = input.authMethod === 'tls_client_auth' ? null : `vsc_${randomToken(32)}`;
    const actor = currentActor();
    const row = await tx.serviceClient.create({
      data: {
        tenantId,
        name: input.name,
        authMethod: input.authMethod,
        scopes: input.scopes,
        secretHash: secret === null ? null : sha256Hex(secret),
        certificateThumbprint: thumbprint,
        createdBy: actor,
        updatedBy: actor,
      },
    });
    await this.audit.record(tx, {
      action: 'identity.serviceClient.created',
      target: { type: 'ServiceClient', id: row.id, name: row.name },
      after: {
        authMethod: row.authMethod,
        scopes: row.scopes,
        certificateBound: thumbprint !== null,
      },
    });
    return { ...(await this.view(row)), clientSecret: secret };
  }

  async update(
    id: string,
    expectedVersion: number,
    input: z.output<typeof UpdateServiceClientSchema>,
  ) {
    if (input.scopes !== undefined) this.assertDelegable(input.scopes);
    const tx = this.db.current();
    const current = await this.find(id);
    if (current.version !== expectedVersion) throw new VersionMismatchError(current.version);
    const updated = await tx.serviceClient.updateMany({
      where: { id, tenantId: this.db.tenantId(), version: expectedVersion, deletedAt: null },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.scopes === undefined ? {} : { scopes: input.scopes }),
        ...(input.status === undefined ? {} : { status: input.status }),
        updatedBy: currentActor(),
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) throw new VersionMismatchError();
    const after = await this.find(id);
    await this.audit.record(tx, {
      action: 'identity.serviceClient.updated',
      target: { type: 'ServiceClient', id, name: after.name },
      before: { name: current.name, scopes: current.scopes, status: current.status },
      after: { name: after.name, scopes: after.scopes, status: after.status },
    });
    return this.view(after);
  }

  async rotateSecret(id: string) {
    const tx = this.db.current();
    const current = await this.find(id);
    if (current.authMethod === 'tls_client_auth')
      throw new DomainError('VERBIS_VALIDATION_FAILED', 'tls_client_auth clients have no secret');
    const secret = `vsc_${randomToken(32)}`;
    const row = await tx.serviceClient.update({
      where: { id },
      data: { secretHash: sha256Hex(secret), updatedBy: currentActor(), version: { increment: 1 } },
    });
    await this.audit.record(tx, {
      action: 'identity.serviceClient.secretRotated',
      target: { type: 'ServiceClient', id, name: row.name },
    });
    return { ...(await this.view(row)), clientSecret: secret };
  }

  async remove(id: string, expectedVersion: number): Promise<void> {
    const tx = this.db.current();
    const current = await this.find(id);
    if (current.version !== expectedVersion) throw new VersionMismatchError(current.version);
    await tx.serviceClient.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        status: 'disabled',
        updatedBy: currentActor(),
        version: { increment: 1 },
      },
    });
    await this.audit.record(tx, {
      action: 'identity.serviceClient.deleted',
      target: { type: 'ServiceClient', id, name: current.name },
    });
  }

  private async find(id: string): Promise<Row> {
    const row = await this.db
      .current()
      .serviceClient.findFirst({ where: { id, tenantId: this.db.tenantId(), deletedAt: null } });
    if (row === null) throw new NotFoundError('Service client');
    return row;
  }
}
