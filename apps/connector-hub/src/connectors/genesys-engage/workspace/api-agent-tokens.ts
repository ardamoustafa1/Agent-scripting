import type { AgentToken, AgentTokenSource } from './workspace-session.js';

/** The slice of the hub's API client the Engage workspace mode needs. */
export interface EngageAgentApi {
  engageLinkedAgents(slug: string, connectorId: string): Promise<string[]>;
  engageAgentToken(slug: string, connectorId: string, platformUserId: string): Promise<AgentToken>;
}

/** Agent tokens are vended by the API over the hub's mTLS client (never cached on disk). */
export function apiAgentTokens(
  api: EngageAgentApi,
  slug: string,
  connectorId: string,
): AgentTokenSource {
  return {
    linkedAgents: () => api.engageLinkedAgents(slug, connectorId),
    token: (platformUserId) => api.engageAgentToken(slug, connectorId, platformUserId),
  };
}
