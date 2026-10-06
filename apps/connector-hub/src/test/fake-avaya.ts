import type {
  SidecarCommand,
  SidecarTransport,
} from '../connectors/shared/nats-sidecar-transport.js';

type Agent = { loginId?: string; extension?: string; handle?: string } | undefined;

/** In-memory Avaya sidecar: records commands, answers verify from the envelopes it "produced". */
export class FakeAvayaSidecar implements SidecarTransport {
  readonly commands: (SidecarCommand & Record<string, unknown>)[] = [];
  readonly owners = new Map<string, { agent: string | undefined; live: boolean }>();
  connected = true;

  observe(payload: unknown): void {
    const p = payload as {
      interactionId?: string;
      event?: string;
      agent?: Agent;
      transferTo?: Agent;
      afterCallWork?: boolean;
    } | null;
    if (typeof p?.interactionId !== 'string' || typeof p.event !== 'string') return;
    const ended =
      p.event === 'acwCompleted' ||
      p.event === 'closed' ||
      (p.event === 'cleared' && p.afterCallWork !== true);
    const agent =
      p.event === 'transferred'
        ? p.transferTo?.loginId
        : (p.agent?.loginId ?? this.owners.get(p.interactionId)?.agent);
    this.owners.set(p.interactionId, { agent, live: !ended });
  }

  start(): Promise<void> {
    return Promise.resolve();
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }

  send(command: SidecarCommand): Promise<void> {
    this.commands.push(command as SidecarCommand & Record<string, unknown>);
    return Promise.resolve();
  }

  verify(platformUserId: string, interactionId: string): Promise<boolean> {
    const owner = this.owners.get(interactionId);
    return Promise.resolve(owner?.live === true && owner.agent === platformUserId);
  }
}

/** Recorder endpoint stand-in shared by the Avaya specs. */
export function fakeRecorder() {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = ((url: string | URL, init: RequestInit = {}) => {
    calls.push({
      url: String(url),
      body: JSON.parse(
        typeof init.body === 'string'
          ? init.body
          : (() => {
              throw new Error('Expected JSON request body');
            })(),
      ) as Record<string, unknown>,
    });
    return Promise.resolve(new Response(null, { status: 204 }));
  }) as typeof fetch;
  return { calls, fetchImpl };
}

/**
 * In-memory AXP: Keycloak token, engagement state from observed notifications, wrap-up and the
 * recorder endpoint.
 */
export class FakeAxp {
  readonly calls: { method: string; url: string; body: unknown; headers: Headers }[] = [];
  readonly engagements = new Map<string, Map<string, string>>();
  tokenRequests = 0;
  failNext: number | undefined;

  observe(frame: unknown): void {
    const f = frame as {
      loginId?: string;
      destinationLoginId?: string;
      body?: { event?: string; action?: string; engagementId?: string };
    } | null;
    const id = f?.body?.engagementId;
    if (id === undefined || f?.loginId === undefined) return;
    const participants = this.engagements.get(id) ?? new Map<string, string>();
    const set = (login: string, state: string | undefined) =>
      state === undefined ? participants.delete(login) : participants.set(login, state);
    switch (`${f.body?.event ?? ''}.${f.body?.action ?? ''}`) {
      case 'MatchOffered.':
      case 'AgentParticipant.INVITED':
        set(f.loginId, 'INVITED');
        break;
      case 'AgentParticipant.ADDED':
      case 'AgentParticipant.UNHELD':
        set(f.loginId, 'ACTIVE');
        break;
      case 'AgentParticipant.HELD':
        set(f.loginId, 'HELD');
        break;
      case 'AgentParticipant.REMOVED':
      case 'AfterContactWorkActivated.':
        set(f.loginId, 'ACW');
        break;
      case 'AfterContactWorkCompleted.':
        set(f.loginId, undefined);
        break;
      case 'SingleStepTransfer.':
        set(f.loginId, undefined);
        if (f.destinationLoginId !== undefined) set(f.destinationLoginId, 'INVITED');
        break;
    }
    this.engagements.set(id, participants);
  }

  readonly fetch = ((input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const body =
      typeof init.body === 'string' && init.body.startsWith('{')
        ? (JSON.parse(init.body) as unknown)
        : init.body;
    this.calls.push({ method, url: url.toString(), body, headers: new Headers(init.headers) });
    if (url.pathname.endsWith('/protocol/openid-connect/token')) {
      this.tokenRequests += 1;
      return Promise.resolve(
        Response.json({ access_token: `axp-token-${String(this.tokenRequests)}`, expires_in: 900 }),
      );
    }
    if (this.failNext !== undefined) {
      const status = this.failNext;
      this.failNext = undefined;
      return Promise.resolve(new Response(null, { status }));
    }
    if (url.hostname === 'recorder.acme.internal')
      return Promise.resolve(new Response(null, { status: 204 }));
    const m = /\/api\/engagement\/v1\/accounts\/[^/]+\/engagements\/([^/]+)$/.exec(url.pathname);
    if (method === 'GET' && m !== null) {
      const participants = this.engagements.get(decodeURIComponent(m[1] ?? ''));
      if (participants === undefined) return Promise.resolve(new Response(null, { status: 404 }));
      return Promise.resolve(
        Response.json({
          engagementId: m[1],
          participants: [...participants].map(([loginId, state]) => ({
            type: 'AGENT',
            loginId,
            agentId: `ag-${loginId}`,
            state,
          })),
        }),
      );
    }
    if (method === 'POST' && /\/interactions\/[^/]+\/wrapup$/.test(url.pathname))
      return Promise.resolve(new Response(null, { status: 204 }));
    return Promise.resolve(new Response(null, { status: 404 }));
  }) as typeof fetch;
}
