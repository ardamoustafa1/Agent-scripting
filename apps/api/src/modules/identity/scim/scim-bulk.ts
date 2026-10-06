import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { requestContext } from '../../../common/context/request-context.js';
import { IdentityTx } from '../core/identity-tx.js';

import { PatchRequestSchema } from './scim-patch.js';
import { SCIM_ERROR_SCHEMA, ScimError } from './scim.errors.js';
import { ScimGroupInputSchema, ScimUserInputSchema } from './scim.resources.js';
import { ScimService } from './scim.service.js';

export const SCIM_BULK_MAX_OPERATIONS = 100;
export const SCIM_BULK_MAX_PAYLOAD = 1_048_576;
const OperationSchema = z.object({
  method: z.enum(['POST', 'PUT', 'PATCH', 'DELETE']),
  path: z.string().max(256),
  bulkId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
  data: z.unknown().optional(),
});
export const ScimBulkRequestSchema = z
  .object({
    schemas: z.tuple([z.literal('urn:ietf:params:scim:api:messages:2.0:BulkRequest')]),
    failOnErrors: z.number().int().min(0).max(SCIM_BULK_MAX_OPERATIONS).optional(),
    Operations: z.array(OperationSchema).min(1),
  })
  .meta({ id: 'ScimBulkRequest' });
type BulkRequest = z.infer<typeof ScimBulkRequestSchema>;
type Operation = BulkRequest['Operations'][number];
interface Result {
  method: Operation['method'];
  bulkId?: string;
  location?: string;
  status: string;
  response?: { schemas: string[]; status: string; detail: string; scimType?: string };
}
const PATH = /^\/(Users|Groups)(?:\/([0-9a-f-]{36}|bulkId:[A-Za-z0-9_-]+))?$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function failure(operation: Operation, error: unknown): Result {
  const status =
    error instanceof ScimError ? error.status : error instanceof z.ZodError ? 400 : 500;
  return {
    method: operation.method,
    ...(operation.bulkId === undefined ? {} : { bulkId: operation.bulkId }),
    status: String(status),
    response: {
      schemas: [SCIM_ERROR_SCHEMA],
      status: String(status),
      detail:
        error instanceof ScimError
          ? error.detail
          : status === 400
            ? 'Invalid resource data'
            : 'Internal error',
      ...(error instanceof ScimError && error.scimType ? { scimType: error.scimType } : {}),
    },
  };
}

/** RFC 7644 §3.7: each operation and its audit commit independently, including partial failures. */
@Injectable()
export class ScimBulkService {
  constructor(
    @Inject(ScimService) private readonly scim: ScimService,
    @Inject(IdentityTx) private readonly tx: IdentityTx,
  ) {}

  async execute(tenant: string, input: BulkRequest) {
    const principal = requestContext.require().principal;
    if (!principal?.id.startsWith('scim:')) throw new ScimError(403, 'SCIM credential required');
    if (
      input.Operations.length > SCIM_BULK_MAX_OPERATIONS ||
      Buffer.byteLength(JSON.stringify(input)) > SCIM_BULK_MAX_PAYLOAD
    )
      throw new ScimError(413, 'Bulk request exceeds service limits', 'tooMany');
    const creators = new Map<string, Operation>();
    for (const operation of input.Operations) {
      if (operation.method !== 'POST') continue;
      if (!operation.bulkId || creators.has(operation.bulkId))
        throw new ScimError(400, 'POST operations require unique bulkId values', 'invalidSyntax');
      creators.set(operation.bulkId, operation);
    }
    const ids = new Map<string, string>();
    const failed = new Set<string>();
    const results = new Map<number, Result>();
    let pending = input.Operations.map((operation, index) => ({ operation, index }));
    let errors = 0;
    const limitReached = () => !!input.failOnErrors && errors >= input.failOnErrors;
    while (pending.length && !limitReached()) {
      const deferred: typeof pending = [];
      let progressed = false;
      for (const { operation, index } of pending) {
        if (limitReached()) break;
        try {
          const resolved = this.resolve(operation, ids, creators, failed);
          if (!resolved) {
            deferred.push({ operation, index });
            continue;
          }
          const result = await this.tx.run(principal.tenantId, principal, () =>
            this.apply(tenant, resolved),
          );
          const location =
            operation.method === 'DELETE'
              ? this.scim.baseUrl(tenant) + resolved.path
              : (result?.['meta'] as { location: string }).location;
          results.set(index, {
            method: operation.method,
            ...(operation.bulkId === undefined ? {} : { bulkId: operation.bulkId }),
            location,
            status:
              operation.method === 'POST' ? '201' : operation.method === 'DELETE' ? '204' : '200',
          });
          if (operation.method === 'POST' && operation.bulkId && typeof result?.['id'] === 'string')
            ids.set(operation.bulkId, result['id']);
        } catch (error) {
          const denied = failure(operation, error);
          results.set(index, denied);
          if (operation.method === 'POST' && operation.bulkId) failed.add(operation.bulkId);
          errors++;
          await this.tx.record(principal.tenantId, principal, {
            action: 'identity.scimBulk.operationFailed',
            target: { type: 'ScimBulk', id: String(index) },
            outcome: 'failure',
            reason: denied.status,
            metadata: { method: operation.method, index },
          });
        }
        progressed = true;
      }
      if (!progressed) {
        for (const { operation, index } of deferred) {
          if (limitReached()) break;
          results.set(
            index,
            failure(
              operation,
              new ScimError(409, 'Unresolvable circular bulkId reference', 'invalidValue'),
            ),
          );
          errors++;
          await this.tx.record(principal.tenantId, principal, {
            action: 'identity.scimBulk.operationFailed',
            target: { type: 'ScimBulk', id: String(index) },
            outcome: 'failure',
            reason: '409',
            metadata: { method: operation.method, index },
          });
        }
        break;
      }
      pending = deferred;
    }
    return {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:BulkResponse'],
      Operations: [...results.entries()].sort(([a], [b]) => a - b).map(([, result]) => result),
    };
  }

  private resolve(
    operation: Operation,
    ids: Map<string, string>,
    creators: Map<string, Operation>,
    failed: Set<string>,
  ): Operation | undefined {
    const match = PATH.exec(operation.path);
    if (
      !match ||
      (match[1] !== 'Users' && match[1] !== 'Groups') ||
      (operation.method === 'POST') !== (match[2] === undefined)
    )
      throw new ScimError(400, 'Invalid operation path', 'invalidPath');
    const unresolved = new Set<string>();
    const resolveId = (value: string): string => {
      if (!value.startsWith('bulkId:')) return value;
      const key = value.slice(7);
      if (!creators.has(key) || failed.has(key))
        throw new ScimError(400, 'Unknown or failed bulkId reference', 'invalidValue');
      const id = ids.get(key);
      if (!id) unresolved.add(key);
      return id ?? value;
    };
    const path = match[2] ? `/${match[1]}/${resolveId(match[2])}` : operation.path;
    // Rewrite only reference attributes, never names or arbitrary client strings.
    const data: unknown = structuredClone(operation.data);
    const rewriteMembers = (value: unknown): void => {
      if (!Array.isArray(value)) return;
      for (const item of value as unknown[]) {
        if (!isRecord(item) || typeof item['value'] !== 'string') continue;
        item['value'] = resolveId(item['value']);
      }
    };
    if (isRecord(data)) {
      rewriteMembers(data['members']);
      if (Array.isArray(data['Operations'])) {
        for (const patch of data['Operations'] as unknown[]) {
          if (!isRecord(patch)) continue;
          if (patch['path'] === 'members') rewriteMembers(patch['value']);
          if (patch['path'] === undefined && isRecord(patch['value']))
            rewriteMembers(patch['value']['members']);
        }
      }
    }
    return unresolved.size ? undefined : { ...operation, path, data };
  }

  private async apply(
    tenant: string,
    operation: Operation,
  ): Promise<Record<string, unknown> | undefined> {
    const match = PATH.exec(operation.path);
    if (!match) throw new ScimError(400, 'Invalid operation path', 'invalidPath');
    const user = match[1] === 'Users';
    const id = match[2] ?? '';
    if (operation.method === 'POST')
      return user
        ? this.scim.createUser(tenant, ScimUserInputSchema.parse(operation.data))
        : this.scim.createGroup(tenant, ScimGroupInputSchema.parse(operation.data));
    if (operation.method === 'PUT')
      return user
        ? this.scim.replaceUser(tenant, id, ScimUserInputSchema.parse(operation.data))
        : this.scim.replaceGroup(tenant, id, ScimGroupInputSchema.parse(operation.data));
    if (operation.method === 'PATCH')
      return user
        ? this.scim.patchUser(tenant, id, PatchRequestSchema.parse(operation.data))
        : this.scim.patchGroup(tenant, id, PatchRequestSchema.parse(operation.data));
    if (user) await this.scim.deleteUser(id);
    else await this.scim.deleteGroup(id);
    return undefined;
  }
}
