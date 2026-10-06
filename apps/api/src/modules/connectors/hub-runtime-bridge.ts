import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';

import { AttributesSchema, WrapUpSchema } from '@verbis/sdk-connector';

import { RuntimePorts, type RuntimeConnector } from '../runtime/runtime-ports.js';

import { HubClient } from './hub-client.js';

/** Connect runtime jobs to the same tenant-authenticated hub used for launch verification. */
@Injectable()
export class HubRuntimeBridge implements OnModuleInit {
  constructor(
    @Inject(HubClient) private readonly hub: HubClient,
    @Inject(RuntimePorts) private readonly ports: RuntimePorts,
  ) {}
  onModuleInit(): void {
    if (!this.hub.configured) return;
    this.ports.registerFallbackConnector(
      (connectorId) =>
        ({
          writeOutcome: async (input) => {
            const attributes = AttributesSchema.parse({
              ...Object.fromEntries(
                Object.entries(input.fields).map(([key, value]) => [
                  key,
                  typeof value === 'object' && value !== null ? JSON.stringify(value) : value,
                ]),
              ),
              ...(input.callbackAt === undefined ? {} : { callbackAt: input.callbackAt }),
            });
            const wrapUp = WrapUpSchema.parse({
              code: input.code,
              subCodes: input.subCodes,
              ...(input.note === undefined ? {} : { note: input.note }),
            });
            const target = { platformInteractionId: input.interactionId };
            if (Object.keys(attributes).length)
              await this.hub.call(
                input.tenantId,
                'POST',
                `/internal/v1/connectors/${connectorId}/commands/writeAttributes`,
                z.null(),
                { ...target, commandId: `${input.commandId}:attributes`, attributes },
              );
            await this.hub.call(
              input.tenantId,
              'POST',
              `/internal/v1/connectors/${connectorId}/commands/setWrapUp`,
              z.null(),
              { ...target, commandId: `${input.commandId}:wrapup`, wrapUp },
            );
          },
          pauseRecording: async (input) => {
            await this.hub.call(
              input.tenantId,
              'POST',
              `/internal/v1/connectors/${connectorId}/commands/${input.paused ? 'pauseRecording' : 'resumeRecording'}`,
              z.null(),
              { platformInteractionId: input.interactionId, commandId: input.commandId },
            );
          },
        }) satisfies RuntimeConnector,
    );
  }
}
