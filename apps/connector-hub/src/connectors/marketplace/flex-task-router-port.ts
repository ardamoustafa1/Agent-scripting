import { z } from 'zod';

import {
  AttributesSchema,
  CommandNotSupportedError,
  ConnectorError,
  UnknownInteractionError,
  type MarketplaceCommand,
  type MarketplaceSdkPort,
  type WrapUp,
} from '@verbis/sdk-connector';

export interface FlexTaskSnapshot {
  readonly attributes: unknown;
  /** TaskRouter `ETag` response header of the task resource. */
  readonly etag: string;
}
export interface FlexTaskRouterApi {
  /** Tenant-scoped lookup; never accepts arbitrary Account/Workspace SIDs. */
  getTask(id: string): Promise<FlexTaskSnapshot | undefined>;
  /** POST with `If-Match: <ifMatch>`; HTTP 412 maps to `precondition-failed`. */
  updateTask(
    id: string,
    attributes: Record<string, unknown>,
    ifMatch: string,
  ): Promise<{ status: 'ok' } | { status: 'precondition-failed' }>;
  complete(id: string, wrapUp: WrapUp): Promise<void>;
  verifyParticipant(workerSid: string, taskSid: string): Promise<boolean>;
}

const MAX_ATTEMPTS = 3;

/**
 * Flex write-back as an optimistic-concurrency read-merge-write: the update carries `If-Match`
 * and a 412 re-reads and re-merges (bounded), so concurrent writers are never overwritten.
 * Unverified against Twilio (audit M-26): ETag/If-Match support is per TaskRouter documentation.
 */
export function createFlexTaskRouterPort(api: FlexTaskRouterApi): MarketplaceSdkPort {
  const task = async (id: string) => {
    const value = await api.getTask(id);
    if (value === undefined) throw new UnknownInteractionError();
    return value;
  };
  return {
    readAttributes: async (id) => (await task(id)).attributes,
    verifyParticipant: (agent, id) => api.verifyParticipant(agent, id),
    execute: async (command: MarketplaceCommand) => {
      if (command.type === 'setWrapUp' && command.wrapUp !== undefined) {
        await api.complete(command.interactionId, command.wrapUp);
        return;
      }
      if (command.type !== 'writeAttributes') throw new CommandNotSupportedError(command.type);
      const incoming = AttributesSchema.parse(command.attributes);
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        const current = await task(command.interactionId);
        if (current.etag === '')
          throw new ConnectorError('Task has no ETag', 'task_etag_missing', false);
        const merged = {
          ...z.record(z.string(), z.unknown()).parse(current.attributes),
          ...incoming,
        };
        const result = await api.updateTask(command.interactionId, merged, current.etag);
        if (result.status === 'ok') return;
      }
      throw new ConnectorError('Task changed concurrently', 'task_conflict', true);
    },
  };
}
