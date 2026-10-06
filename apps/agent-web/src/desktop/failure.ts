import { ZodError } from 'zod';

import { RuntimeProblem } from '@verbis/core-runtime';

import { AgentError } from './api.js';

export interface AgentFailure {
  kind: 'script' | 'authorization' | 'network' | 'storage';
  correlationId: string;
}
export function classifyAgentFailure(error: unknown): AgentFailure {
  const kind =
    error instanceof AgentError && [401, 403].includes(error.status)
      ? 'authorization'
      : error instanceof ZodError ||
          error instanceof RuntimeProblem ||
          (error instanceof AgentError && error.code === 'VERBIS_CLIENT_SCHEMA')
        ? 'script'
        : error instanceof DOMException &&
            ['QuotaExceededError', 'InvalidStateError', 'UnknownError', 'SecurityError'].includes(
              error.name,
            )
          ? 'storage'
          : error instanceof AgentError && (error.status === 0 || error.status >= 500)
            ? 'network'
            : 'script';
  return {
    kind,
    correlationId: error instanceof AgentError ? error.correlationId : crypto.randomUUID(),
  };
}
