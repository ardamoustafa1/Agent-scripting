import { readFileSync } from 'node:fs';

/** Recorded request against the fake Genesys Cloud. */
export interface FakeCall {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
  readonly authorization: string | null;
}

/**
 * In-memory Genesys Cloud for fixture tests: serves OAuth tokens, the latest observed snapshot per
 * conversation (`GET /api/v2/conversations/{id}`), contact-list rows, notification channels, and
 * accepts write-back calls. `failNext` scripts 429/5xx responses for retry tests.
 */
export class FakeGenesys {
  readonly calls: FakeCall[] = [];
  readonly conversations = new Map<string, unknown>();
  readonly contacts: Record<string, unknown>;
  readonly failures: { status: number; headers?: Record<string, string>; match?: RegExp }[] = [];
  tokenRequests = 0;
  channelCount = 0;

  constructor(
    contactsFile?: URL,
    readonly domain = 'mypurecloud.de',
  ) {
    this.contacts =
      contactsFile === undefined
        ? {}
        : (JSON.parse(readFileSync(contactsFile, 'utf8')) as Record<string, unknown>);
  }

  observe(frame: unknown): void {
    const body = (frame as { eventBody?: { id?: unknown } } | null | undefined)?.eventBody;
    if (typeof body?.id === 'string') this.conversations.set(body.id, structuredClone(body));
  }

  failNext(status: number, headers?: Record<string, string>, match?: RegExp): void {
    this.failures.push({
      status,
      ...(headers === undefined ? {} : { headers }),
      ...(match === undefined ? {} : { match }),
    });
  }

  readonly fetch = ((input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const body =
      typeof init.body === 'string' && /^[[{]/.test(init.body)
        ? (JSON.parse(init.body) as unknown)
        : init.body;
    this.calls.push({
      method,
      url: url.toString(),
      body,
      authorization: new Headers(init.headers).get('authorization'),
    });
    const failure = this.failures.findIndex(
      (f) => f.match === undefined || f.match.test(url.pathname),
    );
    if (failure >= 0 && url.host !== `login.${this.domain}`) {
      const [f] = this.failures.splice(failure, 1);
      return Promise.resolve(
        new Response(null, { status: f?.status ?? 500, headers: f?.headers ?? {} }),
      );
    }
    const json = (status: number, value: unknown) =>
      Promise.resolve(Response.json(value, { status }));
    if (url.host === `login.${this.domain}` && url.pathname === '/oauth/token') {
      this.tokenRequests += 1;
      return json(200, {
        access_token: `fake-token-${String(this.tokenRequests)}`,
        token_type: 'bearer',
        expires_in: 86_400,
      });
    }
    if (url.host !== `api.${this.domain}`) return json(404, {});
    const path = url.pathname;
    let m: RegExpExecArray | null;
    if (method === 'GET' && (m = /^\/api\/v2\/conversations\/([^/]+)$/.exec(path)) !== null) {
      const conversation = this.conversations.get(decodeURIComponent(m[1] ?? ''));
      return conversation === undefined
        ? json(404, { code: 'not.found' })
        : json(200, conversation);
    }
    if (
      method === 'GET' &&
      (m = /^\/api\/v2\/outbound\/contactlists\/([^/]+)\/contacts\/([^/]+)$/.exec(path)) !== null
    ) {
      const contact = this.contacts[`${m[1] ?? ''}/${m[2] ?? ''}`];
      return contact === undefined ? json(404, {}) : json(200, contact);
    }
    if (method === 'GET' && /^\/api\/v2\/routing\/queues\/[^/]+\/members$/.test(path))
      return json(200, {
        entities: [{ id: '0f0c2a1e-0000-4000-8000-000000000777' }],
        pageCount: 1,
      });
    if (method === 'POST' && path === '/api/v2/notifications/channels') {
      this.channelCount += 1;
      return json(200, {
        id: `channel-${String(this.channelCount)}`,
        connectUri: `wss://streaming.${this.domain}/channels/channel-${String(this.channelCount)}`,
        expires: '2026-10-02T10:00:00.000Z',
      });
    }
    if (method === 'PUT' && /^\/api\/v2\/notifications\/channels\/[^/]+\/subscriptions$/.test(path))
      return json(200, { entities: body });
    if (
      method === 'PATCH' &&
      /^\/api\/v2\/conversations\/[^/]+\/participants\/[^/]+\/attributes$/.test(path)
    )
      return json(202, {});
    if (
      method === 'POST' &&
      /^\/api\/v2\/conversations\/(calls|callbacks|chats|emails|messages)\/[^/]+\/participants\/[^/]+\/communications\/[^/]+\/wrapup$/.test(
        path,
      )
    )
      return Promise.resolve(new Response(null, { status: 204 }));
    if (method === 'PATCH' && /^\/api\/v2\/conversations\/calls\/[^/]+$/.test(path))
      return json(202, {});
    return json(404, {});
  }) as typeof fetch;

  requests(method: string, pattern: RegExp): FakeCall[] {
    return this.calls.filter((c) => c.method === method && pattern.test(new URL(c.url).pathname));
  }
}

/** Fake socket: tests push frames and close/open it. */
export class FakeSocket {
  readyState = 0;
  readonly sent: string[] = [];
  closedWith: number | undefined;
  readonly #listeners = new Map<string, ((event: { data: unknown }) => void)[]>();

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: (event: { data: unknown }) => void): void {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number): void {
    if (this.readyState === 3) return;
    this.closedWith = code;
    this.readyState = 3;
    this.emit('close');
  }

  open(): void {
    this.readyState = 1;
    this.emit('open');
  }

  frame(value: unknown): void {
    this.emit('message', { data: JSON.stringify(value) });
  }

  /** Server-side drop (no close handshake from us). */
  drop(): void {
    this.readyState = 3;
    this.emit('close');
  }

  emit(type: string, event: { data: unknown } = { data: undefined }): void {
    for (const listener of this.#listeners.get(type) ?? []) listener(event);
  }
}
