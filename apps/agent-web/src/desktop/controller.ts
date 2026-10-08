import { io, type Socket } from 'socket.io-client';
import { z } from 'zod';

import { createComponentRegistry } from '@verbis/components';
import { Runtime, RuntimeProblem, abortable } from '@verbis/core-runtime';
import { JsonValueSchema, type JsonValue } from '@verbis/script-schema';

import { api, Desktop, View, AgentError } from './api.js';
import { classifyAgentFailure, type AgentFailure } from './failure.js';
import { type DraftVault } from './vault.js';

const Pending = z.record(z.string(), z.object({ value: JsonValueSchema, base: JsonValueSchema }));
const Draft = z.object({
  checksum: z.string(),
  pending: Pending,
  note: z.string().max(4000),
  disposition: z.string(),
  callbackAt: z.string(),
});
type Pending = z.infer<typeof Pending>;
export interface AgentState {
  view: View;
  online: boolean;
  pending: number;
  draftSaving: boolean;
  error: string | null;
  failure: AgentFailure | null;
  dataFailure: {
    sourceId: string;
    policy: 'block' | 'continue' | 'manual';
    failure: AgentFailure;
  } | null;
  readOnly: boolean;
  note: string;
  disposition: string;
  callbackAt: string;
  notice: string | null;
  writeback: Desktop['writeback'];
  /** Notices an AI check judged as probably said; never counts as confirmation (ADR-0052 E5). */
  probablySaid: readonly string[];
}
/** One independent controller per securely launched interaction; writes remain server sequenced. */
export class AgentController {
  readonly runtime: Runtime;
  readonly tabId = crypto.randomUUID();
  private token: string | undefined;
  private leaseUntil = 0;
  private pending: Pending = {};
  private disposed = false;
  private applying = false;
  private socket: Socket | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private reconnect: ReturnType<typeof setTimeout> | undefined;
  private tail: Promise<unknown> = Promise.resolve();
  private draftRevision = 0;
  private isDisposed() {
    return this.disposed;
  }
  private durable: Promise<void> = Promise.resolve();
  private last: Record<string, JsonValue>;
  private listeners = new Set<() => void>();
  private stop: () => void;
  private state: AgentState;
  constructor(
    readonly id: string,
    readonly desktop: Desktop,
    private csrf: string,
    private vault: DraftVault,
    locale: string,
  ) {
    this.state = {
      view: desktop.view,
      online: navigator.onLine,
      pending: 0,
      draftSaving: false,
      error: null,
      failure: null,
      dataFailure: null,
      readOnly: true,
      note: '',
      probablySaid: [],
      disposition: '',
      callbackAt: '',
      notice: null,
      writeback: desktop.writeback,
    };
    const variables = Object.fromEntries(
      Object.entries(desktop.view.snapshot.variables).filter(([key]) =>
        desktop.document.variables.some((v) => v.key === key && v.classification !== 'pci'),
      ),
    );
    this.last = { ...variables };
    this.runtime = new Runtime({
      document: desktop.document,
      registry: createComponentRegistry(),
      session: {
        variables,
        interaction: desktop.interaction.context,
        campaign: { name: desktop.campaign.name },
        agent: desktop.agent ?? {},
        locale,
      },
      ports: {
        navigationGuard: () =>
          this.serial(async () => {
            await this.flush();
            if (
              !this.state.online ||
              this.state.readOnly ||
              this.state.pending ||
              this.state.error ||
              this.state.dataFailure
            )
              throw new RuntimeProblem('VERBIS_NAVIGATION_NOT_READY');
          }),
        pageChange: async (pageId, history, signal) => {
          await this.command({ type: 'page', pageId, history: history.slice(-100) }, signal);
        },
        telemetry: (metadata) => {
          void this.serial(async () => {
            if (!this.state.online || this.state.readOnly || !this.token) return;
            await this.flush();
            this.accept(
              await api(`/v1/sessions/${id}/desktop/telemetry`, View, this.csrf, {
                ...this.claim(),
                metadata,
              }),
            );
          }).catch(() => undefined);
        },
        sessionEvent: (event) => {
          if (
            event.action === 'dataSource' &&
            ['failed', 'cancelled'].includes(event.phase) &&
            event.node
          ) {
            const sourceId = event.node;
            queueMicrotask(() => {
              const source = this.runtime.document.dataSources.find(
                (source) => source.id === sourceId,
              );
              const state = this.runtime.store.get(`ds.${sourceId}`);
              if (
                !this.disposed &&
                source &&
                state &&
                typeof state === 'object' &&
                !Array.isArray(state) &&
                state['status'] === 'error' &&
                !this.state.dataFailure
              )
                this.publish({
                  dataFailure: {
                    sourceId,
                    policy: source.policy.onFailure ?? 'block',
                    failure: {
                      kind: event.phase === 'cancelled' ? 'network' : 'script',
                      ...(event.phase === 'cancelled' ? { reason: 'timeout' as const } : {}),
                      correlationId: crypto.randomUUID(),
                    },
                  },
                });
            });
          }
          if (
            event.action === 'flow' &&
            event.phase === 'completed' &&
            this.runtime.store.get('runtime.ended') === true
          )
            void this.wrapup().catch(() => {
              this.publish({ error: this.state.error ?? 'sync' });
            });
        },
        dataSourceErrorHandled: (sourceId) => {
          if (this.state.dataFailure?.sourceId === sourceId) this.publish({ dataFailure: null });
        },
        dataSource: async (request) =>
          this.serial(async () => {
            await this.flush();
            try {
              const result = await abortable(
                api(
                  `/v1/sessions/${id}/desktop/data-source`,
                  z.object({ value: z.unknown(), view: View }),
                  this.csrf,
                  { ...this.claim(), sourceId: request.id, input: request.inputs },
                  request.signal,
                ),
                request.signal,
              );
              this.accept(result.view);
              this.publish({ dataFailure: null });
              return result.value;
            } catch (error) {
              if (error instanceof AgentError && error.integrationError) {
                try {
                  await this.refresh(true);
                } catch {
                  this.publish({ online: false, failure: classifyAgentFailure(error) });
                }
              }
              if (!request.signal.aborted) {
                this.publish({
                  dataFailure: {
                    sourceId: request.id,
                    policy:
                      this.runtime.document.dataSources.find((source) => source.id === request.id)
                        ?.policy.onFailure ?? 'block',
                    failure: classifyAgentFailure(error),
                  },
                });
              }
              throw error;
            }
          }),
        command: async (action) => {
          if (action.type === 'setDisposition') {
            this.preferences({ disposition: action.code });
            return;
          }
          if (action.type === 'submitOutcome') {
            this.preferences({ disposition: action.outcome });
            await this.wrapup();
            return;
          }
          if (action.type === 'transferHint') {
            this.publish({ notice: action.target });
            return;
          }
          throw new RuntimeProblem('VERBIS_PLATFORM_ACTION_UNAVAILABLE');
        },
        toast: (message) => {
          this.publish({ notice: this.runtime.message(message) });
        },
      },
    });
    const fields = this.runtime.store.subscribe(['vars.*'], () => {
      this.changed();
    });
    const ended = this.runtime.store.subscribe(['runtime.ended'], () => {
      if (this.runtime.store.get('runtime.ended') === true)
        void this.wrapup().catch(() => {
          this.publish({ error: this.state.error ?? 'sync' });
        });
    });
    this.stop = () => {
      fields();
      ended();
    };
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.state;
  private publish(patch: Partial<AgentState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private claim() {
    if (!this.token || this.state.readOnly) throw new AgentError(403, 'VERBIS_WRITER_REQUIRED');
    return {
      tabId: this.tabId,
      writeToken: this.token,
      expectedSequence: this.state.view.sequence,
    };
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.catch(() => undefined).then(work);
    this.tail = next;
    return next;
  }
  private accept(view: View) {
    if (view.sequence < this.state.view.sequence) return;
    this.publish({ view });
    this.applying = true;
    try {
      for (const [key, value] of Object.entries(view.snapshot.variables)) {
        const definition = this.runtime.document.variables.find((v) => v.key === key);
        if (
          definition &&
          definition.scope !== 'global' &&
          definition.classification !== 'pci' &&
          !this.pending[key]
        ) {
          this.runtime.store.setVariable(key, value);
          this.last[key] = value;
        }
      }
    } finally {
      this.applying = false;
    }
  }
  private persist() {
    const copy = {
      checksum: this.desktop.checksum,
      pending: structuredClone(this.pending),
      note: this.state.note,
      disposition: this.state.disposition,
      callbackAt: this.state.callbackAt,
    };
    const revision = ++this.draftRevision;
    this.publish({ draftSaving: true });
    this.durable = this.durable
      .catch(() => undefined)
      .then(() => this.vault.save(this.id, copy))
      .finally(() => {
        if (revision === this.draftRevision) this.publish({ draftSaving: false });
      });
    void this.durable.catch((error: unknown) => {
      this.publish({
        error: 'storage',
        failure: { ...classifyAgentFailure(error), kind: 'storage' },
      });
    });
    return this.durable;
  }
  private changed() {
    if (this.applying || this.disposed) return;
    for (const definition of this.runtime.document.variables) {
      if (
        definition.scope === 'global' ||
        this.runtime.store.classification(definition.key) === 'pci'
      )
        continue;
      const value = this.runtime.store.variable(definition.key);
      if (JSON.stringify(value) === JSON.stringify(this.last[definition.key])) continue;
      const pending = this.pending[definition.key];
      this.pending[definition.key] = {
        value,
        base: pending?.base ?? this.last[definition.key] ?? null,
      };
      this.last[definition.key] = value;
    }
    this.publish({ pending: Object.keys(this.pending).length });
    void this.persist();
    if (this.state.online && !this.state.readOnly)
      void this.serial(() => this.flush()).catch(() => {
        this.publish({ error: this.state.error ?? 'sync' });
      });
  }
  async initialize() {
    const loaded = Draft.safeParse(await this.vault.load(this.id));
    if (this.disposed) return;
    if (loaded.success) {
      if (loaded.data.checksum !== this.desktop.checksum) {
        this.publish({ error: 'version' });
        return;
      }
      this.pending = loaded.data.pending;
      this.publish({
        note: loaded.data.note,
        disposition: loaded.data.disposition,
        callbackAt: loaded.data.callbackAt,
        pending: Object.keys(this.pending).length,
      });
      this.applying = true;
      try {
        for (const [key, entry] of Object.entries(this.pending)) {
          const definition = this.runtime.document.variables.find((v) => v.key === key);
          if (!definition || definition.classification === 'pci')
            throw Error('VERBIS_DRAFT_INVALID');
          this.runtime.store.setVariable(key, entry.value);
          this.last[key] = entry.value;
        }
      } finally {
        this.applying = false;
      }
    }
    if (['completed', 'abandoned', 'expired'].includes(this.state.view.state)) {
      const page = this.state.view.snapshot.currentPage ?? this.desktop.document.pages[0]?.id;
      if (page) this.runtime.resume(page);
      if (this.state.writeback === 'queued') this.connect();
      return;
    }
    await this.renew();
    if (this.isDisposed()) return;
    if (this.state.view.state === 'launching' && !this.state.readOnly)
      await this.command({ type: 'transition', state: 'active' });
    if (this.state.view.snapshot.currentPage)
      this.runtime.resume(this.state.view.snapshot.currentPage, this.state.view.snapshot.history);
    else if (!this.state.readOnly) {
      try {
        await this.runtime.start();
      } catch (error) {
        if (!this.state.dataFailure) throw error;
      }
    } else {
      const first = this.desktop.document.pages[0];
      if (first) this.runtime.resume(first.id);
    }
    await this.serial(() => this.flush()).catch(() => {
      this.publish({ error: this.state.error ?? 'sync' });
    });
    window.addEventListener('pagehide', this.releaseOnPageHide);
    this.connect();
    this.timer = setInterval(() => {
      void this.serial(async () => {
        if (['completed', 'abandoned', 'expired'].includes(this.state.view.state)) {
          if (this.timer) clearInterval(this.timer);
          this.timer = undefined;
          return;
        }
        if (!this.state.readOnly || this.leaseUntil <= Date.now()) await this.renew();
        await this.flush();
        await this.refresh();
      }).catch(() => {
        this.publish({ online: false });
      });
    }, 20000);
  }
  async renew(takeover = false) {
    const lease = await api(
      `/v1/sessions/${this.id}/${takeover ? 'takeover' : 'attach'}`,
      View.extend({ writeToken: z.string().optional(), leaseUntil: z.string().nullable() }),
      this.csrf,
      { tabId: this.tabId, ...(!takeover && this.token ? { writeToken: this.token } : {}) },
    );
    if (this.disposed) {
      if (lease.writeToken && !lease.readOnly) this.releaseLease(lease.writeToken);
      return;
    }
    this.token = lease.writeToken;
    this.leaseUntil = lease.leaseUntil ? Date.parse(lease.leaseUntil) : 0;
    this.accept(lease);
    this.publish({
      readOnly: lease.readOnly || !this.token,
      online: true,
      error: ['sync', 'authorization'].includes(this.state.error ?? '') ? null : this.state.error,
      failure:
        this.state.failure && ['authorization', 'network'].includes(this.state.failure.kind)
          ? null
          : this.state.failure,
    });
  }
  takeover() {
    return this.serial(async () => {
      await this.renew(true);
      if (this.disposed || this.state.readOnly) return;
      if (
        Object.entries(this.pending).some(([key, entry]) => {
          const remote = this.state.view.snapshot.variables[key] ?? null;
          return (
            JSON.stringify(remote) !== JSON.stringify(entry.base) &&
            JSON.stringify(remote) !== JSON.stringify(entry.value)
          );
        })
      ) {
        this.publish({ error: 'conflict' });
        await this.persist();
        return;
      }
      if (this.state.view.state === 'launching') await this.activateAfterTakeover();
      if (this.state.view.snapshot.currentPage)
        this.runtime.resynchronize(
          this.state.view.snapshot.currentPage,
          this.state.view.snapshot.history,
        );
      await this.flush();
    });
  }
  private async activateAfterTakeover() {
    // Already inside the command queue: do not recursively enqueue a command.
    this.accept(
      await api(`/v1/sessions/${this.id}/commands`, View, this.csrf, {
        ...this.claim(),
        command: { type: 'transition', state: 'active' },
      }),
    );
  }
  releaseOnPageHide = () => {
    if (!this.token || this.state.readOnly) return;
    this.releaseLease(this.token);
  };
  private releaseLease(writeToken: string) {
    void fetch(`/api/v1/sessions/${this.id}/release`, {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
      redirect: 'error',
      headers: { 'content-type': 'application/json', 'x-csrf-token': this.csrf },
      body: JSON.stringify({ tabId: this.tabId, writeToken }),
    }).catch(() => undefined);
  }
  async recoverDataSource(mode: 'retry' | 'continue' | 'manual') {
    const failure = this.state.dataFailure;
    if (!failure || this.state.readOnly || !this.state.online) return;
    if (mode === 'retry') {
      await this.runtime.callDataSource(failure.sourceId, undefined);
      return;
    }
    if (failure.policy !== mode) throw new AgentError(403, 'VERBIS_RECOVERY_FORBIDDEN');
    await this.serial(async () => {
      await this.flush();
      this.accept(
        await api(`/v1/sessions/${this.id}/desktop/data-source-recovery`, View, this.csrf, {
          ...this.claim(),
          sourceId: failure.sourceId,
          mode,
        }),
      );
      if (mode === 'manual') {
        const source = this.runtime.document.dataSources.find(
          (source) => source.id === failure.sourceId,
        );
        this.runtime.store.set(`ds.${failure.sourceId}`, {
          ...Object.fromEntries(
            Object.entries(source?.outputs ?? {}).map(([key, output]) => [
              key,
              output.variable ? this.runtime.store.variable(output.variable) : null,
            ]),
          ),
          status: 'success',
          loading: false,
          error: null,
        });
      }
      this.publish({ dataFailure: null });
    });
  }
  async refresh(context = false) {
    const view = await api(`/v1/sessions/${this.id}/state`, View);
    this.accept(view);
    if (['completed', 'abandoned', 'expired'].includes(view.state))
      this.publish({ readOnly: true });
    if (context || ['completed', 'abandoned', 'expired'].includes(view.state)) {
      const desktop = await api(`/v1/sessions/${this.id}/desktop`, Desktop);
      this.desktop.interaction = desktop.interaction;
      this.publish({ writeback: desktop.writeback });
      if (
        ['completed', 'abandoned', 'expired'].includes(view.state) &&
        desktop.writeback !== 'queued'
      )
        this.socket?.disconnect();
    }
  }
  private async flush() {
    await this.durable;
    if (!this.state.online || this.state.readOnly || this.disposed) return;
    for (const [key, entry] of Object.entries(this.pending)) {
      if (this.pending[key] !== entry) continue;
      try {
        const view = await api(`/v1/sessions/${this.id}/commands`, View, this.csrf, {
          ...this.claim(),
          command: { type: 'field', variable: key, value: entry.value },
        });
        this.accept(view);
      } catch (error) {
        if (error instanceof AgentError && error.status === 412) {
          const current = await api(`/v1/sessions/${this.id}/state`, View);
          this.accept(current);
          const remote = current.snapshot.variables[key] ?? null;
          if (JSON.stringify(remote) === JSON.stringify(entry.value)) {
            /* A lost acknowledgement: the server already has this value. */
          } else if (JSON.stringify(remote) === JSON.stringify(entry.base)) {
            const view = await api(`/v1/sessions/${this.id}/commands`, View, this.csrf, {
              ...this.claim(),
              command: { type: 'field', variable: key, value: entry.value },
            });
            this.accept(view);
          } else {
            this.publish({ error: 'conflict' });
            throw error;
          }
        } else {
          if (error instanceof AgentError && [401, 403].includes(error.status))
            this.publish({
              readOnly: true,
              error: 'authorization',
              failure: classifyAgentFailure(error),
            });
          else this.publish({ online: false, failure: classifyAgentFailure(error) });
          throw error;
        }
      }
      if (this.pending[key] !== entry)
        this.pending[key] = { ...this.pending[key], base: entry.value };
      if (this.pending[key] === entry)
        this.pending = Object.fromEntries(
          Object.entries(this.pending).filter(([name]) => name !== key),
        );
      this.publish({ pending: Object.keys(this.pending).length, error: null, failure: null });
      await this.persist();
    }
  }
  resolveConflict(choice: 'local' | 'server') {
    return this.serial(async () => {
      await this.renew();
      const current = await api(`/v1/sessions/${this.id}/state`, View);
      if (choice === 'server') {
        this.pending = {};
        this.accept(current);
      } else {
        this.pending = Object.fromEntries(
          Object.entries(this.pending).map(([key, entry]) => [
            key,
            { ...entry, base: current.snapshot.variables[key] ?? null },
          ]),
        );
        this.accept(current);
      }
      this.publish({ pending: Object.keys(this.pending).length, error: null, failure: null });
      await this.persist();
      await this.flush();
    });
  }
  command(command: unknown, signal?: AbortSignal) {
    return this.serial(async () => {
      await this.flush();
      if (!this.state.online) throw new AgentError(503, 'VERBIS_OFFLINE');
      let view: View;
      try {
        view = await api(
          `/v1/sessions/${this.id}/commands`,
          View,
          this.csrf,
          {
            ...this.claim(),
            command,
          },
          signal,
        );
      } catch (error) {
        if (error instanceof AgentError && [401, 403].includes(error.status))
          this.publish({
            readOnly: true,
            error: 'authorization',
            failure: classifyAgentFailure(error),
          });
        throw error;
      }
      this.accept(view);
      return view;
    });
  }
  confirmSecureReceipt(variable: string, receipt: string, signal: AbortSignal): Promise<void> {
    return this.serial(async () => {
      await this.flush();
      if (!this.state.online || this.state.readOnly) throw new AgentError(503, 'VERBIS_OFFLINE');
      const view = await api(
        `/v1/sessions/${this.id}/secure-field`,
        View,
        this.csrf,
        { ...this.claim(), variable, receipt },
        signal,
      );
      this.accept(view);
    });
  }
  async wrapup() {
    await this.serial(async () => {
      if (!['active', 'paused'].includes(this.state.view.state)) return;
      await this.flush();
      if (!this.state.online) throw new AgentError(503, 'VERBIS_OFFLINE');
      this.accept(
        await api(`/v1/sessions/${this.id}/commands`, View, this.csrf, {
          ...this.claim(),
          command: { type: 'transition', state: 'wrapup' },
        }),
      );
    });
  }
  /** Marks notices as probably said; the agent's own confirmation stays the only thing that counts. */
  markProbablySaid(ids: readonly string[]) {
    this.publish({ probablySaid: [...new Set([...this.state.probablySaid, ...ids])] });
  }
  preferences(patch: Partial<Pick<AgentState, 'note' | 'disposition' | 'callbackAt'>>) {
    this.publish(patch);
    void this.persist();
  }
  async complete(subCodes: string[] = []) {
    return this.serial(async () => {
      await this.flush();
      if (!this.state.online) throw new AgentError(503, 'VERBIS_OFFLINE');
      const fields = Object.fromEntries(
        this.runtime.document.variables
          .filter((v) => v.scope !== 'global' && this.runtime.store.classification(v.key) !== 'pci')
          .map((v) => [v.key, this.runtime.store.variable(v.key)]),
      );
      const view = await api(`/v1/sessions/${this.id}/outcome`, View, this.csrf, {
        ...this.claim(),
        code: this.state.disposition,
        subCodes,
        note: this.state.note,
        fields,
        ...(this.state.callbackAt
          ? { callbackAt: new Date(this.state.callbackAt).toISOString() }
          : {}),
      });
      this.accept(view);
      this.publish({ readOnly: true, writeback: 'queued' });
      await this.vault.remove(this.id);
      return view;
    });
  }
  private connect() {
    if (this.disposed) return;
    void api(`/v1/sessions/${this.id}/socket-ticket`, z.object({ ticket: z.string() }), this.csrf, {
      afterSequence: this.state.view.sequence,
    })
      .then((result) => {
        if (this.disposed) return;
        const socket = io('/runtime', {
          transports: ['websocket'],
          auth: { ticket: result.ticket },
          reconnection: false,
        });
        this.socket = socket;
        socket.on('runtime.resume', () => {
          void this.serial(async () => {
            await this.refresh(true);
            if (
              !['completed', 'abandoned', 'expired'].includes(this.state.view.state) &&
              this.leaseUntil <= Date.now()
            )
              await this.renew();
            this.publish({ online: true });
            await this.flush();
          }).catch(() => {
            this.publish({ online: false });
          });
        });
        socket.on('runtime.event', () => {
          void this.serial(() => this.refresh(true)).catch((error: unknown) => {
            this.publish({ online: false, failure: classifyAgentFailure(error) });
          });
        });
        socket.on('runtime.error', () => {
          this.publish({ error: 'authorization', readOnly: true });
        });
        socket.on('disconnect', () => {
          this.retry();
        });
        socket.on('connect_error', () => {
          this.retry();
        });
      })
      .catch(() => {
        this.retry();
      });
  }
  private retry() {
    if (
      this.disposed ||
      this.reconnect ||
      (['completed', 'abandoned', 'expired'].includes(this.state.view.state) &&
        this.state.writeback !== 'queued')
    )
      return;
    this.publish({ online: false });
    this.socket?.disconnect();
    this.reconnect = setTimeout(
      () => {
        this.reconnect = undefined;
        this.connect();
      },
      2000 + Math.random() * 1000,
    );
  }
  dispose() {
    if (this.disposed) return;
    this.releaseOnPageHide();
    this.disposed = true;
    window.removeEventListener('pagehide', this.releaseOnPageHide);
    this.stop();
    this.runtime.dispose();
    this.socket?.disconnect();
    if (this.timer) clearInterval(this.timer);
    if (this.reconnect) clearTimeout(this.reconnect);
    this.listeners.clear();
  }
}
