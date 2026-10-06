import type { EngageCommand } from '../connectors/genesys-engage/envelope.js';
import type { WorkspacePool } from '../connectors/genesys-engage/workspace/workspace-pool.js';
import type { SidecarTransport } from '../connectors/shared/nats-sidecar-transport.js';

interface Owner {
  agent: string | undefined;
  live: boolean;
}

const ownerOf = (
  payload: unknown,
):
  | { id: string; agent: string | undefined; event: string; transferTo: string | undefined }
  | undefined => {
  const p = payload as {
    interactionId?: unknown;
    event?: unknown;
    agent?: { employeeId?: unknown };
    transferTo?: { employeeId?: unknown };
  } | null;
  if (typeof p?.interactionId !== 'string' || typeof p.event !== 'string') return undefined;
  return {
    id: p.interactionId,
    event: p.event,
    agent: typeof p.agent?.employeeId === 'string' ? p.agent.employeeId : undefined,
    transferTo: typeof p.transferTo?.employeeId === 'string' ? p.transferTo.employeeId : undefined,
  };
};

/** In-memory sidecar: records commands, answers verify from the envelopes it "produced". */
export class FakeSidecar implements SidecarTransport {
  readonly commands: EngageCommand[] = [];
  readonly owners = new Map<string, Owner>();
  failNext: { code: string; retryable: boolean } | undefined;
  connected = true;

  observe(payload: unknown): void {
    const o = ownerOf(payload);
    if (o === undefined) return;
    const live = o.event !== 'markedDone' && o.event !== 'abandoned';
    this.owners.set(o.id, {
      agent: o.event === 'partyChanged' ? o.transferTo : (o.agent ?? this.owners.get(o.id)?.agent),
      live,
    });
  }

  start(): Promise<void> {
    return Promise.resolve();
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }

  send(command: EngageCommand | { type: string; commandId: string }): Promise<void> {
    if (this.failNext !== undefined) {
      const failure = this.failNext;
      this.failNext = undefined;
      return Promise.reject(Object.assign(new Error(failure.code), failure));
    }
    this.commands.push(command as EngageCommand);
    return Promise.resolve();
  }

  verify(platformUserId: string, interactionId: string): Promise<boolean> {
    const owner = this.owners.get(interactionId);
    return Promise.resolve(owner?.live === true && owner.agent === platformUserId);
  }
}

/** In-memory Workspace session pool: records REST calls per agent. */
export class FakeWorkspacePool implements WorkspacePool {
  readonly requests: { agentRef: string; method: string; path: string; body: unknown }[] = [];
  readonly connectedAgents = new Set<string>(['E1001', 'E2002']);
  size = 2;
  down = 0;

  sync(): Promise<void> {
    return Promise.resolve();
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }

  request(agentRef: string, method: 'GET' | 'POST', path: string, body: unknown): Promise<unknown> {
    this.requests.push({ agentRef, method, path, body });
    return Promise.resolve({ status: { code: 0 } });
  }

  isConnected(agentRef: string): boolean {
    return this.connectedAgents.has(agentRef);
  }
}
