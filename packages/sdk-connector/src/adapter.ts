/** Supported platforms (ADR-0008). Genesys Engage is server-side only — no WDE. */
export const ADAPTER_TYPES = [
  'genesys-cloud',
  'genesys-engage',
  'avaya-aes',
  'avaya-axp',
  'avaya-aacc',
  'amazon-connect',
  'cisco',
  'nice-cxone',
  'five9',
  'generic',
] as const;

export type AdapterType = (typeof ADAPTER_TYPES)[number];

export function isAdapterType(value: string): value is AdapterType {
  return (ADAPTER_TYPES as readonly string[]).includes(value);
}

/** The API stores adapter types in snake_case (`connector_adapter` enum); events carry that form. */
export function platformOf(type: AdapterType): string {
  return type.replaceAll('-', '_');
}

export const CHANNEL_TYPES = [
  'voice',
  'chat',
  'email',
  'sms',
  'whatsapp',
  'social',
  'video',
  'callback',
] as const;

export type ChannelType = (typeof CHANNEL_TYPES)[number];

export function isChannelType(value: string): value is ChannelType {
  return (CHANNEL_TYPES as readonly string[]).includes(value);
}
