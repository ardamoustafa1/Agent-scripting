import { expect, it } from 'vitest';

import { AgentError } from './api.js';
import { classifyAgentFailure } from './failure.js';

it.each([
  ['TIMEOUT', 'timeout'],
  ['CIRCUIT_OPEN', 'circuit'],
] as const)(
  'classifies the sanitized upstream %s code while preserving support correlation',
  (code, reason) => {
    expect(
      classifyAgentFailure(new AgentError(502, 'VERBIS_INTEGRATION_FAILED', 'support-safe', code)),
    ).toEqual({ kind: 'network', reason, correlationId: 'support-safe' });
  },
);
