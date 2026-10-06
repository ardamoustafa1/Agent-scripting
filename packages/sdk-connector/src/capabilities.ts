import { CHANNEL_TYPES, type ChannelType } from './adapter.js';

/** What a connector can do beyond receiving events. Commands outside this set are refused. */
export const CONNECTOR_FEATURES = [
  'writeBack',
  'wrapUpCodes',
  'recordingControl',
  'transferContext',
] as const;
export type ConnectorFeature = (typeof CONNECTOR_FEATURES)[number];

export interface ConnectorCapabilities {
  readonly channels: readonly ChannelType[];
  readonly features: readonly ConnectorFeature[];
  /**
   * Concurrent interactions one agent may hold per channel on this platform (e.g. 3 chats + 1
   * email). Absent channels default to 1.
   */
  readonly maxConcurrent?: Partial<Record<ChannelType, number>>;
}

export function supportsChannel(caps: ConnectorCapabilities, channel: ChannelType): boolean {
  return caps.channels.includes(channel);
}

export function supportsFeature(caps: ConnectorCapabilities, feature: ConnectorFeature): boolean {
  return caps.features.includes(feature);
}

/** Commands and the feature each one needs. */
export const COMMAND_FEATURE = {
  writeAttributes: 'writeBack',
  setWrapUp: 'wrapUpCodes',
  pauseRecording: 'recordingControl',
  resumeRecording: 'recordingControl',
} as const satisfies Record<string, ConnectorFeature>;
export type CommandName = keyof typeof COMMAND_FEATURE;

/** Validates a capability declaration (contract kit + registry). */
export function validateCapabilities(caps: ConnectorCapabilities): string[] {
  const problems: string[] = [];
  if (caps.channels.length === 0) problems.push('at least one channel is required');
  for (const channel of caps.channels)
    if (!(CHANNEL_TYPES as readonly string[]).includes(channel))
      problems.push(`unknown channel ${channel}`);
  for (const [channel, max] of Object.entries(caps.maxConcurrent ?? {})) {
    if (!caps.channels.includes(channel as ChannelType))
      problems.push(`maxConcurrent for unsupported ${channel}`);
    if (!Number.isInteger(max) || max < 1 || max > 50)
      problems.push(`maxConcurrent.${channel} out of range`);
  }
  if (new Set(caps.features).size !== caps.features.length) problems.push('duplicate features');
  return problems;
}
