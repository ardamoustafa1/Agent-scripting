import { z } from 'zod';

import { AttributesSchema, WrapUpSchema } from '../connector.js';
import { InteractionEventSchema } from '../interaction.js';

import type { AdapterType } from '../adapter.js';
import type { ConnectorCapabilities } from '../capabilities.js';

export const MARKETPLACE_PROFILES = {
  'amazon-connect': {
    type: 'amazon-connect',
    kind: 'contact-events',
    channels: ['voice', 'chat', 'email', 'callback'],
    features: ['writeBack', 'recordingControl'],
    attributes: 'contactAttributes',
    routing: 'queue',
  },
  'cisco-webex': {
    type: 'cisco',
    kind: 'desktop-widget',
    channels: ['voice', 'chat', 'email'],
    features: ['writeBack', 'wrapUpCodes'],
    attributes: 'callVariables',
    routing: 'queue',
  },
  'cisco-finesse': {
    type: 'cisco',
    kind: 'finesse-gadget',
    channels: ['voice'],
    features: ['writeBack', 'wrapUpCodes'],
    attributes: 'callVariables',
    routing: 'queue',
  },
  'nice-cxone': {
    type: 'nice-cxone',
    kind: 'agent-api',
    channels: ['voice', 'chat', 'email', 'sms'],
    features: ['writeBack', 'wrapUpCodes'],
    attributes: 'contactAttributes',
    routing: 'skill',
  },
  five9: {
    type: 'five9',
    kind: 'desktop-toolkit',
    channels: ['voice', 'chat', 'email'],
    features: ['writeBack', 'wrapUpCodes'],
    attributes: 'callVariables',
    routing: 'campaign',
  },
  'twilio-flex': {
    type: 'generic',
    kind: 'flex-plugin',
    channels: ['voice', 'chat', 'sms', 'whatsapp'],
    features: ['writeBack', 'wrapUpCodes'],
    attributes: 'taskAttributes',
    routing: 'taskQueue',
  },
  salesforce: {
    type: 'generic',
    kind: 'salesforce-open-cti',
    channels: ['voice'],
    features: [],
    attributes: 'recordAttributes',
    routing: 'queue',
  },
  'dynamics-365': {
    type: 'generic',
    kind: 'dynamics-cif',
    channels: ['voice'],
    features: [],
    attributes: 'recordAttributes',
    routing: 'queue',
  },
} as const satisfies Record<
  string,
  ConnectorCapabilities & { type: AdapterType; kind: string; attributes: string; routing: string }
>;
export type MarketplacePlatform = keyof typeof MARKETPLACE_PROFILES;
export const MarketplacePlatformSchema = z.enum([
  'amazon-connect',
  'cisco-webex',
  'cisco-finesse',
  'nice-cxone',
  'five9',
  'twilio-flex',
  'salesforce',
  'dynamics-365',
]);

/** Trusted server bridge envelope, NOT a vendor-native payload or a browser attestation. */
export const MarketplaceEnvelopeSchema = z.strictObject({
  version: z.literal(1),
  platform: MarketplacePlatformSchema,
  event: InteractionEventSchema,
  routingId: z.string().min(1).max(256).optional(),
  variables: AttributesSchema.default({}),
});
export type MarketplaceEnvelope = z.infer<typeof MarketplaceEnvelopeSchema>;

export const MarketplaceCommandSchema = z
  .strictObject({
    type: z.enum(['writeAttributes', 'setWrapUp', 'pauseRecording', 'resumeRecording']),
    commandId: z.string().min(1).max(256),
    interactionId: z.string().min(1).max(256),
    platform: MarketplacePlatformSchema,
    attributes: AttributesSchema.optional(),
    wrapUp: WrapUpSchema.optional(),
  })
  .superRefine((command, ctx) => {
    if (command.type === 'writeAttributes' && command.attributes === undefined)
      ctx.addIssue({ code: 'custom', path: ['attributes'], message: 'attributes required' });
    if (command.type === 'setWrapUp' && command.wrapUp === undefined)
      ctx.addIssue({ code: 'custom', path: ['wrapUp'], message: 'wrapUp required' });
  });
export type MarketplaceCommand = z.infer<typeof MarketplaceCommandSchema>;

/** Server-side SDK port. Implementations must use a fresh platform lookup, not browser claims. */
export interface MarketplaceSdkPort {
  readAttributes(interactionId: string): Promise<unknown>;
  execute(command: MarketplaceCommand): Promise<void>;
  verifyParticipant(agentId: string, interactionId: string): Promise<boolean>;
}

/** Inject the licensed/vendor SDK at the edge; never import server credentials into widgets. */
export function createMarketplaceSdkBridge(
  platform: MarketplacePlatform,
  port: MarketplaceSdkPort,
) {
  return {
    readAttributes: async (interactionId: string) =>
      AttributesSchema.parse(await port.readAttributes(interactionId)),
    execute: async (input: unknown) => {
      const command = MarketplaceCommandSchema.parse(input);
      if (command.platform !== platform) throw new Error('Wrong bridge platform');
      await port.execute(command);
    },
    verifyParticipant: (agentId: string, interactionId: string) =>
      port.verifyParticipant(agentId, interactionId),
  };
}
