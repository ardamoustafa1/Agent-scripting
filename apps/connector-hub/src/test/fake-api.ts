import { ConnectorError, type InteractionEvent } from '@verbis/sdk-connector';

import type {
  ConnectorHealthReport,
  HubConnector,
  IngestResult,
  VerbisApi,
} from '../api/verbis-api.js';

export const TENANT_SLUG = 'acme';
export const TENANT_ID = '0190f000-0000-7000-8000-0000000000aa';

/** In-memory API: records calls, maps platform users through a fixed table. Test-only. */
export class FakeVerbisApi implements VerbisApi {
  connectors: HubConnector[] = [];
  secrets: Record<string, Record<string, string>> = {};
  users: Record<string, string> = {};
  readonly ingested: { connectorId: string; event: InteractionEvent }[] = [];
  readonly launches: { connectorId: string; interactionId: string; userId: string }[] = [];
  readonly health: { connectorId: string; report: ConnectorHealthReport }[] = [];
  failIngest = 0;
  readonly #ids = new Map<string, string>();

  tenantSlugs() {
    return [TENANT_SLUG];
  }
  tenantIdOf() {
    return Promise.resolve(TENANT_ID);
  }
  listConnectors() {
    return Promise.resolve(this.connectors);
  }
  resolveSecrets(_slug: string, connectorId: string) {
    return Promise.resolve(this.secrets[connectorId] ?? {});
  }
  reportHealth(_slug: string, connectorId: string, report: ConnectorHealthReport) {
    this.health.push({ connectorId, report });
    return Promise.resolve();
  }
  ingest(_slug: string, connectorId: string, event: InteractionEvent): Promise<IngestResult> {
    if (this.failIngest > 0) {
      this.failIngest -= 1;
      return Promise.reject(new ConnectorError('API responded 503', 'http_503', true));
    }
    this.ingested.push({ connectorId, event });
    const key = `${connectorId}:${event.platformInteractionId}`;
    const interactionId =
      this.#ids.get(key) ??
      `0190f000-0000-7000-8000-${String(this.#ids.size + 1).padStart(12, '0')}`;
    this.#ids.set(key, interactionId);
    const platformUser =
      event.type === 'transferred' ? (event.transferTo ?? event.agent) : event.agent;
    const agentId = platformUser === undefined ? null : (this.users[platformUser.id] ?? null);
    return Promise.resolve({ interactionId, agentId, status: event.type });
  }
  createLaunchIntent(
    _slug: string,
    input: { connectorId: string; interactionId: string; userId: string },
  ) {
    this.launches.push(input);
    return Promise.resolve();
  }
  readonly engageAgents: Record<string, string[]> = {};
  engageLinkedAgents(_slug: string, connectorId: string) {
    return Promise.resolve(this.engageAgents[connectorId] ?? []);
  }
  engageAgentToken(_slug: string, _connectorId: string, platformUserId: string) {
    return Promise.resolve({
      accessToken: `fake-agent-token-${platformUserId}`,
      expiresAt: Date.now() + 3_600_000,
    });
  }
}
