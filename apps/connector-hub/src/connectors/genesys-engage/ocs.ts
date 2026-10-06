import { type EngageCommand } from './envelope.js';

type OcsCommand = Extract<EngageCommand, { type: 'ocsRecordProcessed' }>;

/**
 * OCS desktop-protocol attributes sent as a T-Server user event (`GSW_AGENT_REQ_TYPE`).
 * The sidecar transmits it as `RequestDistributeUserEvent`; Workspace mode uses
 * `send-user-event`. Recorded contract only: unverified against a live OCS.
 */
export function ocsUserData(command: OcsCommand): Record<string, string | number> {
  return {
    GSW_AGENT_REQ_TYPE: command.final ? 'RecordProcessed' : 'UpdateCallCompletionStats',
    GSW_RECORD_HANDLE: command.recordHandle,
    ...(command.callResult === undefined ? {} : { GSW_CALL_RESULT: command.callResult }),
    ...(command.applicationId === undefined ? {} : { GSW_APPLICATION_ID: command.applicationId }),
    ...(command.campaignName === undefined ? {} : { GSW_CAMPAIGN_NAME: command.campaignName }),
    ...command.fields,
  };
}
