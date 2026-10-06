import { createContext, useContext, type ReactNode } from 'react';

import { RuntimeProblem } from '@verbis/core-runtime';

export interface ComponentEnvironment {
  /** Origins are trusted tenant policy from the BFF, never script props. HTTPS only. */
  mediaOrigins: readonly string[];
  frameOrigins: readonly string[];
  knowledgeOrigins: readonly string[];
  features: readonly string[];
  now: () => number;
  /** Provisioned by authenticated host policy, never by ScriptDocument or URL params. */
  secureCapture?: {
    url: string;
    origin: string;
    sessionId: string;
    confirmReceipt: (variable: string, receipt: string, signal: AbortSignal) => Promise<void>;
  };
  scheduleCallback?: (request: {
    scheduledAt: string;
    timeZone: string;
    signal: AbortSignal;
  }) => Promise<void>;
}
const context = createContext<ComponentEnvironment>({
  mediaOrigins: [],
  frameOrigins: [],
  knowledgeOrigins: [],
  features: [],
  now: Date.now,
});
export function ComponentProvider({
  environment,
  children,
}: {
  environment: ComponentEnvironment;
  children: ReactNode;
}) {
  return <context.Provider value={environment}>{children}</context.Provider>;
}
export function useComponentEnvironment(): ComponentEnvironment {
  return useContext(context);
}
export function safeAssetUrl(input: string, origins: readonly string[]): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new RuntimeProblem('VERBIS_COMPONENT_URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password || !origins.includes(url.origin))
    throw new RuntimeProblem('VERBIS_COMPONENT_URL');
  return url.href;
}
export function readPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const key of path.split('.')) {
    if (
      ['__proto__', 'constructor', 'prototype'].includes(key) ||
      current === null ||
      typeof current !== 'object' ||
      !Object.hasOwn(current, key)
    )
      return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (!descriptor || !('value' in descriptor)) return undefined;
    current = descriptor.value as unknown;
  }
  return current;
}
export function display(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : typeof value === 'boolean'
      ? String(value)
      : '';
}
