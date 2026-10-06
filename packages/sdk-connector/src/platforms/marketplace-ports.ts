import { z } from 'zod';

import { AttributesSchema, type Attributes, type WrapUp } from '../connector.js';
import { CommandNotSupportedError, UnknownInteractionError } from '../errors.js';

import { type MarketplaceCommand, type MarketplaceSdkPort } from './marketplace.js';

/** Promise facade over @aws-sdk/client-connect commands, using server IAM credentials. */
export interface AmazonConnectApi {
  getContactAttributes(input: { InstanceId: string; InitialContactId: string }): Promise<unknown>;
  updateContactAttributes(input: {
    InstanceId: string;
    InitialContactId: string;
    Attributes: Record<string, string>;
  }): Promise<unknown>;
  describeContact(input: { InstanceId: string; ContactId: string }): Promise<unknown>;
  suspendContactRecording(input: {
    InstanceId: string;
    ContactId: string;
    InitialContactId: string;
  }): Promise<unknown>;
  resumeContactRecording(input: {
    InstanceId: string;
    ContactId: string;
    InitialContactId: string;
  }): Promise<unknown>;
}
const ContactResponse = z.object({
  Contact: z.object({
    InitialContactId: z.string().min(1),
    DisconnectTimestamp: z.unknown().optional(),
    AgentInfo: z.object({ Id: z.string().min(1) }).optional(),
  }),
});
export function createAmazonConnectPort(
  instanceId: string,
  api: AmazonConnectApi,
): MarketplaceSdkPort {
  const contact = async (id: string) =>
    ContactResponse.parse(await api.describeContact({ InstanceId: instanceId, ContactId: id }))
      .Contact;
  return {
    readAttributes: async (id) => {
      const current = await contact(id);
      return z.object({ Attributes: z.record(z.string(), z.string()).default({}) }).parse(
        await api.getContactAttributes({
          InstanceId: instanceId,
          InitialContactId: current.InitialContactId,
        }),
      ).Attributes;
    },
    verifyParticipant: async (agent, id) => {
      try {
        const current = await contact(id);
        return current.DisconnectTimestamp === undefined && current.AgentInfo?.Id === agent;
      } catch {
        return false;
      }
    },
    execute: async (command) => {
      const current = await contact(command.interactionId);
      const target = {
        InstanceId: instanceId,
        ContactId: command.interactionId,
        InitialContactId: current.InitialContactId,
      };
      switch (command.type) {
        case 'writeAttributes':
          await api.updateContactAttributes({
            InstanceId: instanceId,
            InitialContactId: current.InitialContactId,
            Attributes: Object.fromEntries(
              Object.entries(AttributesSchema.parse(command.attributes)).map(([key, value]) => [
                key,
                value === null ? '' : String(value),
              ]),
            ),
          });
          return;
        case 'pauseRecording':
          await api.suspendContactRecording(target);
          return;
        case 'resumeRecording':
          await api.resumeContactRecording(target);
          return;
        case 'setWrapUp':
          throw new CommandNotSupportedError(command.type);
      }
    },
  };
}

/** Thin version-specific SDK facades; implementations live in each vendor's signed host bundle. */
export interface DesktopSdkApi {
  readVariables(id: string): Promise<unknown>;
  updateVariables(id: string, attributes: Attributes): Promise<void>;
  disposition(id: string, wrapUp: WrapUp): Promise<void>;
  /** MUST query server CTI state; a widget callback alone is insufficient. */
  verifyParticipant(agent: string, id: string): Promise<boolean>;
}
function desktopPort(
  api: DesktopSdkApi,
  validate = (attributes: Attributes) => attributes,
): MarketplaceSdkPort {
  return {
    readAttributes: (id) => api.readVariables(id),
    verifyParticipant: (agent, id) => api.verifyParticipant(agent, id),
    execute: async (command) => {
      switch (command.type) {
        case 'writeAttributes':
          await api.updateVariables(
            command.interactionId,
            validate(AttributesSchema.parse(command.attributes)),
          );
          return;
        case 'setWrapUp':
          if (command.wrapUp === undefined) throw new Error('wrapUp required');
          await api.disposition(command.interactionId, command.wrapUp);
          return;
        default:
          throw new CommandNotSupportedError(command.type);
      }
    },
  };
}
export const createWebexDesktopPort = (api: DesktopSdkApi): MarketplaceSdkPort => desktopPort(api);
export const createNiceCxonePort = (api: DesktopSdkApi): MarketplaceSdkPort => desktopPort(api);
export const createFive9ToolkitPort = (api: DesktopSdkApi): MarketplaceSdkPort => desktopPort(api);
export const createFinessePort = (api: DesktopSdkApi): MarketplaceSdkPort =>
  desktopPort(api, (attributes) => {
    for (const [name, value] of Object.entries(attributes)) {
      if (!/^(callVariable([1-9]|10)|user\.[A-Za-z0-9_.-]+)$/.test(name))
        throw new Error('Invalid call variable or ECC name');
      if (value !== null && String(value).length > 210)
        throw new Error('Call variable exceeds configured limit');
    }
    return attributes;
  });

export interface FlexTask {
  readonly attributes: unknown;
  setAttributes(attributes: Record<string, unknown>): Promise<unknown>;
}
export interface FlexSdkApi {
  /** Tenant-scoped TaskRouter task lookup; never accept arbitrary Account/Workspace SIDs. */
  task(id: string): Promise<FlexTask | undefined>;
  complete(id: string, wrapUp: WrapUp): Promise<void>;
  /** Fresh accepted reservation/worker assignment, excluding completed/cancelled tasks. */
  verifyParticipant(workerSid: string, taskSid: string): Promise<boolean>;
}
export function createTwilioFlexPort(api: FlexSdkApi): MarketplaceSdkPort {
  const task = async (id: string) => {
    const value = await api.task(id);
    if (value === undefined) throw new UnknownInteractionError();
    return value;
  };
  return {
    readAttributes: async (id) => (await task(id)).attributes,
    verifyParticipant: (agent, id) => api.verifyParticipant(agent, id),
    execute: async (command: MarketplaceCommand) => {
      if (command.type === 'writeAttributes') {
        const current = await task(command.interactionId);
        await current.setAttributes({
          ...z.record(z.string(), z.unknown()).parse(current.attributes),
          ...AttributesSchema.parse(command.attributes),
        });
      } else if (command.type === 'setWrapUp' && command.wrapUp !== undefined)
        await api.complete(command.interactionId, command.wrapUp);
      else throw new CommandNotSupportedError(command.type);
    },
  };
}

/** CRM hosts launch an existing CTI interaction; record ownership cannot attest call ownership. */
export interface CrmLaunchApi {
  readRecordContext(interactionId: string): Promise<unknown>;
  verifyCtiParticipant(agent: string, interactionId: string): Promise<boolean>;
}
function crmPort(api: CrmLaunchApi): MarketplaceSdkPort {
  return {
    readAttributes: (id) => api.readRecordContext(id),
    verifyParticipant: (agent, id) => api.verifyCtiParticipant(agent, id),
    execute: (command) => Promise.reject(new CommandNotSupportedError(command.type)),
  };
}
export const createSalesforceOpenCtiPort = (api: CrmLaunchApi): MarketplaceSdkPort => crmPort(api);
export const createDynamicsCifPort = (api: CrmLaunchApi): MarketplaceSdkPort => crmPort(api);
