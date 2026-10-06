import { createHash, randomUUID } from 'node:crypto';

import { Server, type Document, type Connection } from '@hocuspocus/server';
import {
  Inject,
  Logger,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { z, ZodError } from 'zod';

import {
  MAX_FRAME_BYTES,
  UpdateTooLargeError,
  assertUpdateWithinLimit,
  initializeDocument,
  readDocument,
  Y,
} from '@verbis/collaboration';
import { instruments } from '@verbis/observability';
import { ScriptDocumentSchema } from '@verbis/script-schema';

import { requestContext, systemContext } from '../../common/context/request-context.js';
import { uuidv7 } from '../../common/crypto/uuid.js';
import { DomainError, ForbiddenError } from '../../common/errors/domain-errors.js';
import { API_ENV, type ApiEnv } from '../../env.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { RedisService } from '../../infra/redis/redis.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AbilityFactory } from '../authz/ability.factory.js';
import { LaunchRealtime, type LaunchGrant } from '../launch/launch-realtime.js';

import { checksumOf } from './document-storage.js';
import { DraftLeaseService } from './draft-lease.service.js';
import { ScriptsService } from './scripts.service.js';
import { TeamService } from './team.service.js';

import type { FastifyRequest } from 'fastify';

interface Grant extends LaunchGrant {
  scriptId: string;
  number: number;
  documentName: string;
}
interface Room {
  grant: Grant;
  version: number;
  lease: string;
  document?: Document;
  frozen: boolean;
  recoveryId?: string;
  contributors: Set<string>;
  owners: Map<number, string>;
}
const Binding = z.object({
  scriptId: z.uuid(),
  number: z.number().int().positive(),
  tenantId: z.uuid(),
});
const bindingKey = (ticket: string) =>
  `collaboration:ticket:${createHash('sha256').update(ticket).digest('hex')}`;
const Presence = z.object({
  pageId: z.string().max(128),
  selection: z.array(z.string().max(128)).max(100),
  cursor: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).nullable(),
});
@Injectable()
export class CollaborationService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CollaborationService.name);
  private listening = false;
  ready() {
    return !this.env.COLLABORATION_PORT || this.listening;
  }
  private server: Server<Grant> | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly clients = new Map<string, { grant: Grant; connection: Connection<Grant> }>();
  private readonly checks = new Set<string>();
  private readonly rooms = new Map<string, Room>();
  private readonly owner = randomUUID();
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(LaunchRealtime) private readonly tickets: LaunchRealtime,
    @Inject(AbilityFactory) private readonly abilities: AbilityFactory,
    @Inject(TeamService) private readonly team: TeamService,
    @Inject(ScriptsService) private readonly scripts: ScriptsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DraftLeaseService) private readonly leases: DraftLeaseService,
  ) {}
  private name(tenant: string, script: string, number: number) {
    return `${tenant}:${script}:${number}`;
  }
  async issue(request: FastifyRequest, scriptId: string, number: number) {
    if (!this.server)
      throw new DomainError('VERBIS_VALIDATION_FAILED', 'Collaboration server is disabled');
    const version = await this.team.authorize(scriptId, number, 'update');
    if (version.state !== 'draft')
      throw new DomainError(
        'VERBIS_SCRIPT_VERSION_IMMUTABLE',
        'Only draft versions can collaborate',
      );
    const issued = await this.tickets.issue(request),
      tenantId = this.db.tenantId();
    await this.redis.client.set(
      bindingKey(issued.ticket),
      JSON.stringify({ scriptId, number, tenantId }),
      'EX',
      30,
    );
    return {
      ticket: issued.ticket,
      documentName: this.name(tenantId, scriptId, number),
      userId: requestContext.require().principal?.id,
      path: '/collaboration' as const,
    };
  }
  private async run<T>(grant: Grant, work: () => Promise<T>, validateSession = true): Promise<T> {
    if (validateSession) await this.tickets.validate(grant);
    return requestContext.run(
      {
        ...systemContext(uuidv7(), 'collaboration'),
        principal: {
          type: 'user',
          id: grant.userId,
          tenantId: grant.tenantId,
          scopes: [],
          sessionId: grant.bffId,
        },
      },
      () =>
        this.db.run(grant.tenantId, async (tx) => {
          const ctx = requestContext.require();
          ctx.tx = tx;
          const tenant = await tx.tenant.findFirst({
            where: { id: grant.tenantId, status: 'active', deletedAt: null },
            select: { settings: true },
          });
          const authz = tenant
            ? await this.abilities.forPrincipal(
                tx,
                {
                  type: 'user',
                  id: grant.userId,
                  tenantId: grant.tenantId,
                  scopes: [],
                  sessionId: grant.bffId,
                },
                tenant.settings,
              )
            : undefined;
          if (!authz) throw new ForbiddenError();
          ctx.authz = authz;
          return work();
        }),
    );
  }
  onApplicationBootstrap() {
    if (!this.env.COLLABORATION_PORT) return;
    this.server = new Server<Grant>({
      port: this.env.COLLABORATION_PORT,
      address: this.env.COLLABORATION_ADDRESS,
      quiet: true,
      stopOnSignals: false,
      debounce: 1500,
      maxDebounce: 10000,
      timeout: 30000,
      maxUnauthenticatedQueueSize: 65536,
      websocketOptions: { maxPayload: MAX_FRAME_BYTES },
      onAuthenticate: async ({ token, requestHeaders, documentName }) => {
        if (
          (this.rooms.size >= 100 && !this.rooms.has(documentName)) ||
          (this.server?.hocuspocus.getConnectionsCount() ?? 0) >= 500
        )
          throw new ForbiddenError('Collaboration capacity exceeded');
        const grant = await this.tickets.consume(token, requestHeaders.get('origin'));
        const raw = await this.redis.client.getdel(bindingKey(token));
        if (!raw) throw new ForbiddenError();
        const bound = Binding.parse(JSON.parse(raw));
        if (
          bound.tenantId !== grant.tenantId ||
          documentName !== this.name(grant.tenantId, bound.scriptId, bound.number)
        )
          throw new ForbiddenError();
        const context: Grant = { ...grant, ...bound, documentName };
        await this.run(context, async () => {
          const v = await this.team.authorize(bound.scriptId, bound.number, 'update');
          if (v.state !== 'draft') throw new ForbiddenError();
        });
        return context;
      },
      // Hocuspocus requires Promise-returning hooks even for in-memory bookkeeping.
      // eslint-disable-next-line @typescript-eslint/require-await
      connected: async ({ socketId, context, connection }) => {
        this.clients.set(socketId, { grant: context, connection });
      },
      onLoadDocument: async ({ document, context, documentName }) => {
        await this.leases.claim(context.tenantId, context.scriptId, context.number, this.owner);
        try {
          await this.run(context, async () => {
            const v = await this.scripts.getVersion(context.scriptId, context.number);
            const snapshot = await this.db.current().collaborationSnapshot.findFirst({
              where: { tenantId: context.tenantId, scriptVersionId: v.id },
            });
            if (snapshot?.version === v.version) Y.applyUpdate(document, snapshot.state);
            else initializeDocument(document, v.document);
            this.rooms.set(documentName, {
              grant: context,
              version: v.version,
              lease: this.leases.key(context.tenantId, context.scriptId, context.number),
              document,
              frozen: false,
              contributors: new Set(),
              owners: new Map(),
            });
          });
        } catch (error) {
          await this.leases.release(
            this.leases.key(context.tenantId, context.scriptId, context.number),
            this.owner,
          );
          throw error;
        }
      },
      // Hocuspocus hooks require promises; authorization is handled on connect, periodically and at save.
      // eslint-disable-next-line @typescript-eslint/require-await
      beforeHandleMessage: async ({ context, documentName }) => {
        const room = this.rooms.get(documentName);
        if (!room || room.frozen) throw new ForbiddenError();
        room.grant = context;
      },
      beforeSync: async ({ type, payload, document, documentName, context }) => {
        if (type === 0) return;
        try {
          assertUpdateWithinLimit(payload);
        } catch (error) {
          if (error instanceof UpdateTooLargeError) await this.rejectOversize(context, error.size);
          throw error;
        }
        const shadow = new Y.Doc();
        try {
          Y.applyUpdate(shadow, Y.encodeStateAsUpdate(document));
          Y.applyUpdate(shadow, payload);
          if (Y.encodeStateAsUpdate(shadow).byteLength > 2 * 1024 * 1024)
            throw new ForbiddenError();
        } finally {
          shadow.destroy();
        }
        this.rooms.get(documentName)?.contributors.add(context.userId);
      },
      // eslint-disable-next-line @typescript-eslint/require-await
      beforeHandleAwareness: async ({ states, context, documentName, socketId }) => {
        if (!context) return;
        const room = this.rooms.get(documentName);
        if (!room) throw new ForbiddenError();
        // Hocuspocus decodes updates in a scratch Awareness which also contains its own
        // empty local state. Discard invalid entries before counting client identities.
        for (const [id, state] of states)
          if ((state as unknown) !== null && !Presence.safeParse(state).success) states.delete(id);
        if (states.size > 1) throw new ForbiddenError();
        for (const [id, state] of states) {
          // Deleted awareness states carry null at runtime despite Hocuspocus' narrow type.
          if ((state as unknown) === null) continue;
          const owner = room.owners.get(id);
          if (owner && owner !== socketId) throw new ForbiddenError();
          if ([...room.owners].some(([other, socket]) => socket === socketId && other !== id))
            throw new ForbiddenError();
          const parsed = Presence.safeParse(state);
          if (!parsed.success) {
            states.delete(id);
            continue;
          }
          room.owners.set(id, socketId);
          states.set(id, { ...parsed.data, userId: context.userId });
        }
      },
      onStoreDocument: async ({ documentName, document }) => {
        await this.persist(documentName, document);
      },
      // eslint-disable-next-line @typescript-eslint/require-await
      onDisconnect: async ({ documentName, socketId }) => {
        this.clients.delete(socketId);
        const room = this.rooms.get(documentName);
        if (room)
          for (const [id, owner] of room.owners) if (owner === socketId) room.owners.delete(id);
      },
      afterUnloadDocument: async ({ documentName }) => {
        const room = this.rooms.get(documentName);
        if (room) await this.leases.release(room.lease, this.owner);
        this.rooms.delete(documentName);
      },
    });
    void this.server
      .listen()
      .then(() => {
        this.listening = true;
      })
      .catch(() => {
        this.listening = false;
        this.server = undefined;
        this.logger.error('Collaboration listener unavailable');
        instruments.operationFailures.add(1, { operation: 'collaboration.listen' });
      });
    this.timer = setInterval(() => {
      for (const [name, room] of this.rooms) {
        void this.leases.renew(room.lease, this.owner).catch(() => {
          room.frozen = true;
          this.server?.hocuspocus.closeConnections(name);
        });
      }
      for (const [id, client] of this.clients) {
        if (this.checks.has(id)) continue;
        this.checks.add(id);
        void this.run(client.grant, async () => {
          const version = await this.team.authorize(
            client.grant.scriptId,
            client.grant.number,
            'update',
          );
          if (version.state !== 'draft') throw new ForbiddenError();
        })
          .catch(() => {
            client.connection.close();
          })
          .finally(() => this.checks.delete(id));
      }
    }, 10000);
    this.timer.unref();
  }
  /** Metric + audit for a refused oversize update; never throws (the caller closes the socket). */
  private async rejectOversize(grant: Grant, size: number): Promise<void> {
    instruments.operationFailures.add(1, { operation: 'collaboration.update.oversize' });
    this.logger.warn('Collaboration update exceeds size limit');
    try {
      await this.run(
        grant,
        async () => {
          await this.audit.record(this.db.current(), {
            action: 'script.collaboration.updateRejected',
            target: { type: 'Script', id: grant.scriptId },
            outcome: 'denied',
            reason: 'update_too_large',
            metadata: { scriptVersion: grant.number, size },
          });
        },
        false,
      );
    } catch {
      instruments.operationFailures.add(1, { operation: 'collaboration.update.oversize.audit' });
    }
  }
  private readonly stores = new Map<string, Promise<void>>();
  async persist(name: string, document: Document): Promise<void> {
    const prior = this.stores.get(name) ?? Promise.resolve();
    const next = prior
      .catch(() => undefined)
      .then(async () => {
        const room = this.rooms.get(name);
        if (!room || room.recoveryId) return;
        const state = new Uint8Array(Y.encodeStateAsUpdate(document)),
          stateVector = Array.from(Y.encodeStateVector(document)),
          content = readDocument(document),
          actors = [...room.contributors];
        await this.leases.renew(room.lease, this.owner);
        // Final disconnect may follow BFF logout: preserve already authenticated edits with current author permissions.
        await this.run(
          room.grant,
          async () => {
            const current = await this.scripts.getVersion(room.grant.scriptId, room.grant.number);
            await this.team.authorize(room.grant.scriptId, room.grant.number, 'update');
            if (current.state !== 'draft' || current.version !== room.version) {
              const copy = await this.db.current().collaborationConflict.create({
                data: {
                  id: uuidv7(),
                  tenantId: room.grant.tenantId,
                  scriptVersionId: current.id,
                  state,
                  baseVersion: room.version,
                  currentVersion: current.version,
                },
              });
              await this.audit.record(this.db.current(), {
                action: 'script.collaboration.conflictPreserved',
                target: { type: 'ScriptVersion', id: current.id },
                metadata: {
                  recoveryId: copy.id,
                  baseVersion: room.version,
                  currentVersion: current.version,
                  contributors: actors,
                },
              });
              return { recoveryId: copy.id };
            }
            const candidate = ScriptDocumentSchema.parse(content);
            const prepared = await this.scripts.composeForCollaboration(this.db.current(), {
              document: candidate,
              screens: current.screens.map((s) => ({
                sharedScreenId: s.sharedScreenId,
                versionNumber: s.versionNumber,
                mode: s.mode as 'linked' | 'detached',
              })),
            });
            if (checksumOf(ScriptDocumentSchema.parse(prepared)) !== checksumOf(candidate))
              throw new ForbiddenError('Linked content cannot be changed in this room');
            const saved = await this.scripts.updateDraft(
              room.grant.scriptId,
              room.grant.number,
              room.version,
              {
                document: ScriptDocumentSchema.parse(content),
                screens: current.screens.map((s) => ({
                  sharedScreenId: s.sharedScreenId,
                  versionNumber: s.versionNumber,
                  mode: s.mode as 'linked' | 'detached',
                })),
              },
              this.owner,
            );
            const metadata = await this.db.current().scriptVersion.findFirstOrThrow({
              where: { tenantId: room.grant.tenantId, id: current.id },
              select: { source: true },
            });
            const source = z.record(z.string(), z.unknown()).parse(metadata.source ?? {});
            const priorAuthors = z.array(z.string()).safeParse(source['collaborationAuthors']);
            await this.db.current().scriptVersion.updateMany({
              where: { tenantId: room.grant.tenantId, id: current.id, state: 'draft' },
              data: {
                source: JSON.parse(
                  JSON.stringify({
                    ...source,
                    collaborationAuthors: [
                      ...new Set([
                        ...(priorAuthors.success ? priorAuthors.data : []),
                        ...actors.map((id) => `user:${id}`),
                      ]),
                    ],
                  }),
                ) as Record<string, never>,
              },
            });
            await this.db.current().collaborationSnapshot.upsert({
              where: {
                tenantId_scriptVersionId: {
                  tenantId: room.grant.tenantId,
                  scriptVersionId: current.id,
                },
              },
              create: {
                id: uuidv7(),
                tenantId: room.grant.tenantId,
                scriptVersionId: current.id,
                state,
                version: saved.version,
              },
              update: { state, version: saved.version },
            });
            await this.audit.record(this.db.current(), {
              action: 'script.collaboration.snapshotted',
              target: { type: 'ScriptVersion', id: current.id },
              metadata: { checksum: saved.checksum, contributors: actors },
            });
            // In-memory version advances only after the tenant transaction commits.
            return { version: saved.version };
          },
          false,
        ).then((result) => {
          if ('recoveryId' in result) {
            room.recoveryId = result.recoveryId;
            throw new DomainError(
              'VERBIS_SCRIPT_INVALID_TRANSITION',
              'Draft changed outside collaboration; edits preserved',
            );
          }
          room.version = result.version;
          for (const id of actors) room.contributors.delete(id);
        });
        document.broadcastStateless(
          JSON.stringify({ type: 'saved', version: room.version, stateVector }),
        );
      });
    this.stores.set(name, next);
    try {
      await next;
    } catch (error) {
      instruments.operationFailures.add(1, { operation: 'collaboration.persist' });
      this.logger.warn('Collaboration document save refused');
      const room = this.rooms.get(name);
      const invalid =
        error instanceof ZodError ||
        (error instanceof DomainError &&
          (error.code === 'VERBIS_SCRIPT_DOCUMENT_INVALID' ||
            error.code === 'VERBIS_SCREEN_COMPOSITION_CONFLICT'));
      if (room && !invalid) room.frozen = true;
      document.broadcastStateless(
        JSON.stringify({
          type: invalid ? 'invalid' : 'conflict',
          ...(room?.recoveryId ? { recoveryId: room.recoveryId } : {}),
        }),
      );
      throw error;
    } finally {
      if (this.stores.get(name) === next) this.stores.delete(name);
    }
  }
  async conflicts(scriptId: string, number: number) {
    const version = await this.team.authorize(scriptId, number, 'update');
    const rows = await this.db.current().collaborationConflict.findMany({
      where: { tenantId: this.db.tenantId(), scriptVersionId: version.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, baseVersion: true, currentVersion: true, createdAt: true },
    });
    return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  }
  async conflict(scriptId: string, number: number, id: string) {
    const version = await this.team.authorize(scriptId, number, 'update');
    const row = await this.db.current().collaborationConflict.findFirst({
      where: {
        id,
        tenantId: this.db.tenantId(),
        scriptVersionId: version.id,
      },
    });
    if (!row) throw new ForbiddenError();
    const document = new Y.Doc();
    try {
      Y.applyUpdate(document, row.state);
      return { document: ScriptDocumentSchema.parse(readDocument(document)) };
    } finally {
      document.destroy();
    }
  }
  async flush(scriptId: string, number: number) {
    await this.team.authorize(scriptId, number, 'update');
    const name = this.name(this.db.tenantId(), scriptId, number),
      room = this.rooms.get(name);
    if (!room) return { closed: true };
    room.frozen = true;
    if (room.recoveryId)
      throw new DomainError(
        'VERBIS_SCRIPT_INVALID_TRANSITION',
        'Draft changed outside collaboration; edits preserved',
      );
    try {
      if (room.document) await this.persist(name, room.document);
      this.server?.hocuspocus.closeConnections(name);
      await this.leases.release(room.lease, this.owner);
      this.rooms.delete(name);
      return { closed: true };
    } catch (error) {
      room.frozen = room.recoveryId !== undefined;
      throw error;
    }
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (!this.server) return;
    const runtime = this.server.hocuspocus;
    // A flush can leave a fully saved, disconnected document after its unload
    // callback raced a pending store. SDK destroy only flushes queued stores,
    // so explicitly unload idle documents; active/pending documents stay under
    // the SDK's normal save and disconnect lifecycle.
    await Promise.all(
      [...runtime.documents.values()]
        .filter((document) => !document.isLoading && runtime.shouldUnloadDocument(document))
        .map((document) => runtime.unloadDocument(document)),
    );
    await this.server.destroy();
  }
}
