import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { JsonValueSchema } from '@verbis/script-schema';

import { requestContext } from '../../common/context/request-context.js';
import { ForbiddenError, NotFoundError } from '../../common/errors/domain-errors.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { IntegrationEngineService } from '../integrations/integration-engine.service.js';

import { CommandSchema } from './domain/runtime.js';
import { RuntimeEngineService } from './runtime-engine.service.js';

export const RuntimeDataCallSchema = CommandSchema.omit({ command: true }).extend({
  sourceId: z.string().max(128),
  input: z.record(z.string(), JsonValueSchema),
});
export function assertRuntimeOwner(userId: string): void {
  const actor = requestContext.require().principal;
  if (
    actor?.type !== 'user' ||
    actor.id !== userId ||
    actor.authMethod !== 'sso' ||
    !actor.sessionId
  )
    throw new ForbiddenError();
}
@Injectable()
export class RuntimeDataService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(RuntimeEngineService) private readonly runtime: RuntimeEngineService,
    @Inject(IntegrationEngineService) private readonly integrations: IntegrationEngineService,
  ) {}
  async call(id: string, input: z.infer<typeof RuntimeDataCallSchema>) {
    const context = requestContext.require();
    const scoped = <T>(work: () => Promise<T>) =>
      this.db.run(this.db.tenantId(), (tx) => requestContext.run({ ...context, tx }, work));
    const prepared = await scoped(async () => {
      const row = await this.runtime.row(id, true);
      assertRuntimeOwner(row.userId);
      this.runtime.claim(row, input);
      const source = this.runtime.document(row).dataSources.find((s) => s.id === input.sourceId);
      if (!source) throw new NotFoundError('DataSource');
      const record = await this.db.current().dataSource.findFirst({
        where: {
          tenantId: row.tenantId,
          key: source.ref.replace(/^tenant-datasource:/, ''),
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!record) throw new NotFoundError('Pinned DataSource');
      return this.integrations.prepareAuthorized(record.id, id, {
        input: input.input,
        environment: 'prod',
      });
    });
    // No request transaction or session row lock is held across upstream I/O.
    const result = await this.integrations.executePrepared(prepared);
    const view = await scoped(async () => {
      const row = await this.runtime.row(id, true);
      assertRuntimeOwner(row.userId);
      this.runtime.claim(row, input);
      await this.runtime.recordActivity(id, {
        type: 'datasource.called',
        name: input.sourceId,
        status: result.error ? 'failure' : 'success',
        durationMs: Math.min(300000, Math.round(result.durationMs)),
      });
      return this.runtime.view(id);
    });
    if (result.value === undefined) throw this.integrations.failure(result.error);
    return { value: result.value, view };
  }
}
