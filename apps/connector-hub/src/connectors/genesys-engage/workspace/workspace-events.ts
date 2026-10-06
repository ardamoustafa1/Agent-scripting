import { z } from 'zod';

import type { EngageAgent, EngageEnvelopeInput, EngageEventName } from '../envelope.js';

/**
 * Workspace API v3 CometD notifications (`/workspace/v3/voice`, `/workspace/v3/media`) →
 * envelopes. The agent is implicit (the session's own user), so the session passes it in.
 * Field names: `CallStateChanged.call.{id,connId,previousConnId,state,callType,ani,dnis,userData}`
 * and `InteractionStateChanged.interaction.{id,mediatype,state,userData}` (docs §1).
 */
const Str = (max: number) => z.string().max(max);
const KvPair = z.looseObject({ key: Str(128), type: Str(16).optional(), value: z.unknown() });
const UserData = z.array(KvPair).max(500).default([]);

const Call = z.looseObject({
  id: Str(128),
  connId: Str(64).optional(),
  previousConnId: Str(64).optional(),
  state: Str(32),
  callType: Str(32).optional(),
  ani: Str(64).optional(),
  dnis: Str(64).optional(),
  userData: UserData,
});
const Interaction = z.looseObject({
  id: Str(128),
  mediatype: Str(32),
  state: Str(32),
  queue: Str(256).optional(),
  userData: UserData,
  /** email/chat specifics are fetched lazily; subject may be in userData (`Subject`). */
});

export const WorkspaceMessageSchema = z.looseObject({
  channel: Str(128),
  data: z.union([
    z.looseObject({
      messageType: z.literal('CallStateChanged'),
      notificationType: Str(64).optional(),
      call: Call,
    }),
    z.looseObject({
      messageType: z.literal('InteractionStateChanged'),
      notificationType: Str(64).optional(),
      interaction: Interaction,
    }),
    z
      .looseObject({
        messageType: Str(64).refine(
          (t) => t !== 'CallStateChanged' && t !== 'InteractionStateChanged',
        ),
      })
      .transform(() => null),
  ]),
});
export type WorkspaceMessage = z.input<typeof WorkspaceMessageSchema>;

const CALL_STATES: Readonly<Record<string, EngageEventName>> = {
  Ringing: 'ringing',
  Dialing: 'dialing',
  Established: 'established',
  Held: 'held',
  Released: 'released',
  Completed: 'markedDone',
};
const IXN_STATES: Readonly<Record<string, EngageEventName>> = {
  Invite: 'ringing',
  Accepted: 'established',
  Processing: 'established',
  Revoked: 'abandoned',
  Released: 'released',
  Completed: 'markedDone',
};

function flat(pairs: z.infer<typeof UserData>): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  for (const pair of pairs) {
    const v = pair.value;
    if (typeof v === 'string') out[pair.key] = v.slice(0, 4_000);
    else if (typeof v === 'number' && Number.isFinite(v)) out[pair.key] = v;
    else if (v === null) out[pair.key] = null;
  }
  return out;
}

const callType = (value: string | undefined) =>
  value === 'Inbound' || value === 'Outbound' || value === 'Internal' || value === 'Consult'
    ? value
    : 'Unknown';

const mediaOf = (value: string) => {
  const v = value.toLowerCase();
  return v === 'chat' ||
    v === 'email' ||
    v === 'sms' ||
    v === 'whatsapp' ||
    v === 'webchat' ||
    v === 'facebook' ||
    v === 'twitter'
    ? v
    : 'workitem';
};

/**
 * Per-session translator. Workspace notifications carry no event id; ids are derived from the
 * interaction, the state and how often that state was seen (resets on completion), which is
 * stable when the same notification is replayed after a reconnect.
 */
export class WorkspaceTranslator {
  readonly #counts = new Map<string, number>();
  readonly #held = new Set<string>();

  constructor(
    private readonly agent: EngageAgent,
    private readonly agentRef: string,
    private readonly now: () => Date,
  ) {}

  /**
   * Pure: derives the envelope without changing state. Call `commit` once the resulting events
   * were accepted downstream, so a retry after backpressure yields the same event id.
   */
  translate(
    raw: unknown,
  ): { envelope: EngageEnvelopeInput; commit: () => void } | null | 'invalid' {
    const parsed = WorkspaceMessageSchema.safeParse(raw);
    if (!parsed.success) return 'invalid';
    const data = parsed.data.data;
    if (data === null) return null;
    if (data.messageType === 'CallStateChanged') {
      const call = data.call;
      if (data.notificationType === 'AttachedDataChanged') return null;
      let event = CALL_STATES[call.state];
      if (event === undefined) return null;
      const id = call.connId ?? call.id;
      // Established after Held is a retrieve.
      if (event === 'established' && this.#held.has(id)) event = 'retrieved';
      return this.#envelope(event, id, 'voice', {
        callType: callType(call.callType),
        ...(call.previousConnId === undefined
          ? {}
          : { previousInteractionId: call.previousConnId }),
        ...(call.ani === undefined ? {} : { ani: call.ani }),
        ...(call.dnis === undefined ? {} : { dnis: call.dnis }),
        userData: flat(call.userData),
      });
    }
    const ixn = data.interaction;
    if (data.notificationType === 'PropertiesChanged') return null;
    const event = IXN_STATES[ixn.state];
    if (event === undefined) return null;
    const userData = flat(ixn.userData);
    const media = mediaOf(ixn.mediatype);
    return this.#envelope(event, ixn.id, media, {
      ...(ixn.queue === undefined ? {} : { queue: ixn.queue }),
      userData,
      ...(media === 'email'
        ? {
            email: {
              from: String(userData['FromAddress'] ?? ''),
              to: [],
              subject: String(userData['Subject'] ?? '').slice(0, 1_000),
              body: '',
            },
          }
        : {}),
      ...(media === 'chat' || media === 'webchat'
        ? {
            chat: {
              ...(typeof userData['FirstName'] === 'string'
                ? { customerName: userData['FirstName'] }
                : {}),
              messages: [],
            },
          }
        : {}),
    });
  }

  #envelope(
    event: EngageEventName,
    interactionId: string,
    mediaType: EngageEnvelopeInput['mediaType'],
    rest: Partial<EngageEnvelopeInput>,
  ): { envelope: EngageEnvelopeInput; commit: () => void } {
    const key = `${interactionId}:${event}`;
    const n = (this.#counts.get(key) ?? 0) + 1;
    const envelope: EngageEnvelopeInput = {
      schema: 'verbis.engage.envelope.v1',
      eventId: `ws:${this.agentRef}:${interactionId}:${event}:${String(n)}`
        .replace(/[^A-Za-z0-9._:@-]/g, '_')
        .slice(0, 200),
      source: 'workspace',
      event,
      occurredAt: this.now().toISOString(),
      interactionId: interactionId.replace(/[^A-Za-z0-9._:@-]/g, '_').slice(0, 128),
      mediaType,
      agent: this.agent,
      ...rest,
    };
    const commit = () => {
      this.#counts.set(key, n);
      if (event === 'held') this.#held.add(interactionId);
      if (event === 'retrieved') this.#held.delete(interactionId);
      if (event === 'markedDone' || event === 'abandoned') {
        for (const k of [...this.#counts.keys()])
          if (k.startsWith(`${interactionId}:`)) this.#counts.delete(k);
        this.#held.delete(interactionId);
      }
      if (this.#counts.size > 10_000) {
        const oldest = this.#counts.keys().next();
        if (!oldest.done) this.#counts.delete(oldest.value);
      }
    };
    return { envelope, commit };
  }
}
