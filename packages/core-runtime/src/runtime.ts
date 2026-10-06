import { IntlMessageFormat } from 'intl-messageformat';
import { z } from 'zod';

import {
  JsonValueSchema,
  NodeSchema,
  literalMatchesType,
  loadScriptDocument,
  type Condition,
  type Flow,
  type JsonValue,
  type Node,
  type Page,
  type PreviewStep,
  type ScriptDocument,
  type Value,
} from '@verbis/script-schema';

import { ActionExecutor } from './executor.js';
import { RuntimeExpressions } from './expressions.js';
import { abortable, checkAbort, RuntimeProblem } from './problem.js';
import { RuntimeStore, type SessionState } from './store.js';
import { ValidationEngine } from './validation.js';

import type {
  ExternalAction,
  RuntimePorts,
  RuntimeSessionEvent,
  SimulationPorts,
} from './ports.js';
import type { ComponentRegistry } from './registry.js';

export interface RuntimeOptions {
  document: unknown;
  session?: SessionState;
  registry: ComponentRegistry;
  ports: RuntimePorts;
  simulation?: boolean;
  simulationPorts?: SimulationPorts;
  simulationTimers?: boolean;
}
interface FlowFrame {
  flow: Flow;
  cursor: string;
  steps: number;
  traversals: Map<string, number>;
}
/** Shared engine for authorized agent sessions and isolated designer simulations. */
export class Runtime {
  readonly document: ScriptDocument;
  readonly store: RuntimeStore;
  readonly expressions: RuntimeExpressions;
  readonly executor: ActionExecutor;
  readonly validation: ValidationEngine;
  readonly registry: ComponentRegistry;
  readonly ports: RuntimePorts;
  readonly simulation: boolean;
  private simulationPorts: SimulationPorts;
  private simulationTimers: boolean;
  private sequence = 0;
  private disposed = false;
  get signal(): AbortSignal {
    return this.lifetime.signal;
  }
  private lifetime = new AbortController();
  private calls = new Map<string, AbortController>();
  private timerVersions = new Map<string, number>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private departure: { page: string; frames: FlowFrame[] } | undefined;
  private history: { page: string; frames: FlowFrame[] }[] = [];
  private frames: FlowFrame[] = [];
  private started = false;
  private layouts = new Map<string, Node>();
  private messageCache = new Map<string, IntlMessageFormat>();
  constructor(options: RuntimeOptions) {
    const loaded = loadScriptDocument(options.document);
    if (!loaded.ok) throw new RuntimeProblem('VERBIS_DOCUMENT_INVALID');
    this.document = loaded.document;
    this.registry = options.registry;
    this.registry.validate(this.document);
    for (const page of this.document.pages)
      this.layouts.set(page.id, NodeSchema.parse(page.layout));
    this.store = new RuntimeStore(this.document, options.session);
    this.expressions = new RuntimeExpressions(
      this.document,
      this.store,
      options.ports.now ?? Date.now,
    );
    this.ports = options.ports;
    this.simulation = options.simulation ?? false;
    this.simulationPorts = options.simulationPorts ?? {};
    this.simulationTimers = options.simulationTimers ?? true;
    this.executor = new ActionExecutor(this);
    this.validation = new ValidationEngine(
      this,
      this.simulation ? undefined : this.ports.serverValidation,
      this.simulation ? undefined : this.ports.fieldValidation,
    );
  }
  event(
    action: RuntimeSessionEvent['action'],
    phase: RuntimeSessionEvent['phase'],
    code?: string,
    node?: string,
    metadata: Pick<RuntimeSessionEvent, 'path' | 'durationMs' | 'flow' | 'edge'> = {},
  ): void {
    const event: RuntimeSessionEvent = {
      sequence: ++this.sequence,
      action,
      phase,
      simulation: this.simulation,
      timestamp: this.ports.now?.() ?? Date.now(),
      ...metadata,
      ...(code === undefined ? {} : { code }),
      ...(node === undefined ? {} : { node }),
    };
    try {
      this.ports.sessionEvent(event);
    } catch {
      /* Telemetry transport failures do not corrupt interpreter state. Server audit is authoritative. */
    }
  }
  message(key: string, values: Record<string, JsonValue> = {}): string {
    const locale = this.store.locale;
    const template =
      this.document.i18n.messages[locale]?.[key] ??
      this.document.i18n.messages[this.document.i18n.defaultLocale]?.[key];
    if (template === undefined) return key;
    let compiled = this.messageCache.get(key);
    if (!compiled) {
      compiled = new IntlMessageFormat(template, locale, undefined, { ignoreTag: true });
      this.messageCache.set(key, compiled);
    }
    const params = Object.fromEntries(
      Object.entries(values).map(([name, value]) => [
        name,
        typeof value === 'number' || typeof value === 'string'
          ? value
          : typeof value === 'boolean'
            ? String(value)
            : value === null
              ? ''
              : JSON.stringify(value),
      ]),
    );
    try {
      return String(compiled.format(params));
    } catch {
      return key;
    }
  }
  page(id: string): Omit<Page, 'layout'> & { layout: Node } {
    const page = this.document.pages.find((p) => p.id === id);
    if (!page) throw new RuntimeProblem('VERBIS_PAGE_UNKNOWN');
    const layout = this.layouts.get(id);
    if (!layout) throw new RuntimeProblem('VERBIS_PAGE_UNKNOWN');
    return { ...page, layout };
  }
  async start(signal = this.lifetime.signal): Promise<void> {
    if (this.started || this.disposed) return;
    this.started = true;
    this.frames = [this.frame(this.document.flow)];
    try {
      await this.advance(signal, false);
    } catch (error) {
      this.started = false;
      throw error;
    }
  }
  /** Restore an authorized page without replaying flow actions or external side effects. */
  resume(pageId: string, history: readonly string[] = []): void {
    if (this.started) throw new RuntimeProblem('VERBIS_RUNTIME_STARTED');
    this.position(pageId, history);
  }
  /** Apply a new authorized server snapshot without replaying page/flow side effects. */
  resynchronize(pageId: string, history: readonly string[] = []): void {
    if (this.disposed) throw new RuntimeProblem('VERBIS_RUNTIME_DISPOSED');
    this.position(pageId, history);
  }
  private position(pageId: string, history: readonly string[]): void {
    this.page(pageId);
    const locate = (page: string): FlowFrame[] => {
      const walk = (flow: Flow, seen = new Set<string>()): FlowFrame[] | null => {
        if (seen.has(flow.id)) return null;
        const visited = new Set([...seen, flow.id]);
        const node = flow.nodes.find((n) => n.type === 'page' && n.page === page);
        if (node) return [{ ...this.frame(flow), cursor: node.id }];
        for (const call of flow.nodes) {
          if (call.type !== 'subflow') continue;
          const child = this.document.subflows.find((f) => f.id === call.flow);
          const path = child ? walk(child, visited) : null;
          if (path) return [{ ...this.frame(flow), cursor: call.id }, ...path];
        }
        return null;
      };
      const path = walk(this.document.flow);
      if (path) return path;
      for (const flow of this.document.subflows) {
        const found = walk(flow);
        if (found) return found;
      }
      throw new RuntimeProblem('VERBIS_FLOW_NODE_UNKNOWN');
    };
    const frames = locate(pageId);
    const restoredHistory = history.slice(-100).map((page) => ({ page, frames: locate(page) }));
    this.frames = frames;
    this.history = restoredHistory;
    this.started = true;
    this.store.set('runtime.page', pageId);
    for (const page of [...history, pageId]) this.store.set(`runtime.visited.${page}`, true);
  }
  private frame(flow: Flow): FlowFrame {
    return { flow, cursor: flow.start, steps: 0, traversals: new Map() };
  }
  async navigate(
    id: string,
    signal = this.lifetime.signal,
    preserveFlow = false,
    remember = true,
  ): Promise<void> {
    checkAbort(signal);
    await this.ports.navigationGuard?.();
    const oldHistory = [...this.history];
    const next = this.page(id),
      currentId = this.store.get('runtime.page');
    if (typeof currentId === 'string') {
      const current = this.page(currentId);
      if (current.mandatory && (await this.validation.page(currentId, signal)).length)
        throw new RuntimeProblem('VERBIS_VALIDATION_FAILED');
      await this.executor.execute(current.onLeave, signal, `page:${currentId}/onLeave`);
      if (remember)
        this.history.push(
          this.departure ?? {
            page: currentId,
            frames: this.frames.map((f) => ({ ...f, traversals: new Map(f.traversals) })),
          },
        );
      this.departure = undefined;
    }
    checkAbort(signal);
    try {
      await this.ports.pageChange?.(
        id,
        this.history.map((entry) => entry.page),
        signal,
      );
    } catch (error) {
      this.history = oldHistory;
      throw error;
    }
    this.clearTimers();
    for (const controller of this.calls.values()) controller.abort();
    if (!preserveFlow) {
      const frame = this.frames.at(-1) ?? this.frame(this.document.flow);
      const flowNode = frame.flow.nodes.find((n) => n.type === 'page' && n.page === id);
      if (!flowNode) throw new RuntimeProblem('VERBIS_FLOW_PAGE_UNKNOWN');
      frame.cursor = flowNode.id;
      this.frames = [...this.frames.slice(0, -1), frame];
    }
    this.store.batch(() => {
      this.store.resetPageVariables();
      this.store.set('runtime.page', id);
      this.store.set(`runtime.visited.${id}`, true);
    });
    if (this.simulation) {
      this.event('page', 'waiting', undefined, id);
      await this.executor.debugger.checkpoint(signal, [`page:${id}`]);
    }
    this.event('page', 'started', undefined, id);
    await this.executor.execute(next.onEnter, signal, `page:${id}/onEnter`);
    for (const timer of next.timers) if (timer.autoStart) this.startTimer(timer.id);
    for (const ds of this.document.dataSources)
      if (ds.policy.trigger === 'onEnter') await this.callDataSource(ds.id, undefined, signal);
  }
  private edge(frame: FlowFrame, port?: 'success' | 'error'): void {
    const edges = frame.flow.edges.filter(
      (edge) => edge.from === frame.cursor && (edge.port === undefined || edge.port === port),
    );
    const match =
      edges.find((edge) => edge.when && !edge.default && this.expressions.condition(edge.when)) ??
      edges.find((edge) => edge.default) ??
      edges.find((edge) => !edge.when);
    if (!match) throw new RuntimeProblem('VERBIS_FLOW_DEAD_END');
    const count = (frame.traversals.get(match.id) ?? 0) + 1;
    if (match.maxIterations !== undefined && count > match.maxIterations)
      throw new RuntimeProblem('VERBIS_FLOW_LIMIT');
    frame.traversals.set(match.id, count);
    frame.cursor = match.to;
    this.event('flow', 'completed', undefined, match.to, { flow: frame.flow.id, edge: match.id });
  }
  private async advance(signal: AbortSignal, move: boolean): Promise<void> {
    let frame = this.frames.at(-1);
    if (!frame) throw new RuntimeProblem('VERBIS_FLOW_ENDED');
    if (move) this.edge(frame);
    while ((frame = this.frames.at(-1))) {
      checkAbort(signal);
      if (++frame.steps > frame.flow.limits.maxSteps) throw new RuntimeProblem('VERBIS_FLOW_LIMIT');
      const node = frame.flow.nodes.find((n) => n.id === frame?.cursor);
      if (!node) throw new RuntimeProblem('VERBIS_FLOW_NODE_UNKNOWN');
      this.event('flow', 'started', undefined, node.id, { flow: frame.flow.id });
      switch (node.type) {
        case 'start':
          break;
        case 'transfer':
          await this.executor.execute(
            [
              {
                type: 'transferHint',
                target: node.target,
                ...(node.reasonKey ? { reasonKey: node.reasonKey } : {}),
              },
            ],
            signal,
          );
          break;
        case 'page':
          await this.navigate(node.page, signal, true);
          return;
        case 'setVariable':
          await this.executor.execute(
            [{ type: 'setVariable', variable: node.variable, value: node.value }],
            signal,
          );
          break;
        case 'decision':
          break;
        case 'dataSource': {
          let port: 'success' | 'error' = 'success';
          try {
            await this.executor.execute(
              [{ type: 'callDataSource', dataSource: node.dataSource }],
              signal,
            );
          } catch (error) {
            if (signal.aborted) throw error;
            port = 'error';
            if (frame.flow.edges.some((edge) => edge.from === node.id && edge.port === 'error'))
              this.ports.dataSourceErrorHandled?.(node.dataSource);
          }
          this.edge(frame, port);
          continue;
        }
        case 'subflow': {
          const subflow = this.document.subflows.find((f) => f.id === node.flow);
          if (
            !subflow ||
            this.frames.some((f) => f.flow.id === subflow.id) ||
            this.frames.length >= 32
          )
            throw new RuntimeProblem('VERBIS_SUBFLOW_INVALID');
          this.frames.push(this.frame(subflow));
          continue;
        }
        case 'end': {
          if (node.disposition)
            await this.executor.execute(
              [{ type: 'setDisposition', code: node.disposition }],
              signal,
            );
          if (node.outcome)
            await this.executor.execute([{ type: 'submitOutcome', outcome: node.outcome }], signal);
          this.frames.pop();
          if (!this.frames.length) {
            this.store.set('runtime.ended', true);
            return;
          }
          const parent = this.frames.at(-1);
          if (parent) this.edge(parent);
          continue;
        }
      }
      this.edge(frame);
    }
  }
  async next(signal = this.lifetime.signal): Promise<void> {
    await this.ports.navigationGuard?.();
    const page = this.store.get('runtime.page');
    if (
      typeof page === 'string' &&
      this.page(page).mandatory &&
      (await this.validation.page(page, signal)).length
    )
      throw new RuntimeProblem('VERBIS_VALIDATION_FAILED');
    const frames = this.frames.map((frame) => ({
      ...frame,
      traversals: new Map(frame.traversals),
    }));
    this.departure = typeof page === 'string' ? { page, frames } : undefined;
    try {
      await this.advance(signal, true);
    } catch (error) {
      if (this.store.get('runtime.page') === page) this.frames = frames;
      throw error;
    } finally {
      this.departure = undefined;
    }
  }
  async back(signal = this.lifetime.signal): Promise<void> {
    await this.ports.navigationGuard?.();
    const previous = this.history.pop();
    if (!previous) return;
    try {
      await this.navigate(previous.page, signal, true, false);
      this.frames = previous.frames;
    } catch (error) {
      this.history.push(previous);
      throw error;
    }
  }
  async runSubflow(id: string, signal: AbortSignal): Promise<void> {
    const flow = this.document.subflows.find((f) => f.id === id);
    if (!flow || this.frames.some((f) => f.flow.id === id) || this.frames.length >= 32)
      throw new RuntimeProblem('VERBIS_SUBFLOW_INVALID');
    this.frames.push(this.frame(flow));
    await this.advance(signal, false);
  }
  async runRule(id: string, signal = this.lifetime.signal): Promise<void> {
    const rule = this.document.rules.find((r) => r.id === id);
    if (!rule) throw new RuntimeProblem('VERBIS_RULE_UNKNOWN');
    this.event('rule', 'started');
    try {
      await this.executor.execute(
        this.expressions.condition({ $rule: id }) ? rule.then : (rule.else ?? []),
        signal,
      );
      this.event('rule', 'completed');
    } catch {
      this.event('rule', 'failed', 'VERBIS_RULE_FAILED');
      throw new RuntimeProblem('VERBIS_RULE_FAILED');
    }
  }
  async command(
    action: ExternalAction,
    values: Record<string, JsonValue>,
    signal: AbortSignal,
  ): Promise<void> {
    const command = this.simulation ? this.simulationPorts.command : this.ports.command;
    if (!command) {
      if (this.simulation) return;
      throw new RuntimeProblem('VERBIS_CAPABILITY_UNAVAILABLE');
    }
    checkAbort(signal);
    await abortable(command(action, values, signal), signal);
  }
  async callDataSource(
    id: string,
    overrides: Record<string, Value> | undefined,
    parent = this.lifetime.signal,
  ): Promise<void> {
    if (this.disposed) throw new RuntimeProblem('VERBIS_RUNTIME_DISPOSED');
    checkAbort(parent);
    const definition = this.document.dataSources.find((ds) => ds.id === id);
    if (!definition) throw new RuntimeProblem('VERBIS_DATASOURCE_UNKNOWN');
    this.calls.get(id)?.abort();
    const controller = new AbortController();
    this.calls.set(id, controller);
    const abort = () => {
      controller.abort();
    };
    parent.addEventListener('abort', abort, { once: true });
    this.lifetime.signal.addEventListener('abort', abort, { once: true });
    const timeoutState = { expired: false };
    const timeout = setTimeout(() => {
      timeoutState.expired = true;
      controller.abort();
    }, definition.policy.timeoutMs);
    const began = this.ports.now?.() ?? Date.now();
    this.event('dataSource', 'started', undefined, id);
    this.store.set(`ds.${id}`, { status: 'loading', loading: true, error: null });
    try {
      const request = {
        id,
        ref: definition.ref,
        version: definition.version,
        inputs: this.expressions.map({ ...definition.inputs, ...overrides }),
        signal: controller.signal,
      };
      const port = this.simulation ? this.simulationPorts.dataSource : this.ports.dataSource;
      if (!port) throw new RuntimeProblem('VERBIS_DATASOURCE_UNAVAILABLE');
      const raw = await abortable(port(request), controller.signal);
      const schema = z.strictObject(
        Object.fromEntries(Object.keys(definition.outputs).map((key) => [key, JsonValueSchema])),
      );
      const outputs = schema.parse(raw) as Record<string, JsonValue>;
      checkAbort(controller.signal);
      // Validate all mapped variable writes before publishing any of them.
      for (const [key, mapping] of Object.entries(definition.outputs)) {
        if (mapping.variable) {
          const variable = this.document.variables.find((v) => v.key === mapping.variable);
          if (!variable || variable.scope === 'global')
            throw new RuntimeProblem('VERBIS_VARIABLE_READONLY');
          // Store's type validation is applied below; parse with a throwaway store would be wasteful.
          if (!literalMatchesType(variable, outputs[key] ?? null))
            throw new RuntimeProblem('VERBIS_VARIABLE_TYPE');
        }
      }
      checkAbort(controller.signal);
      this.store.batch(() => {
        for (const [key, mapping] of Object.entries(definition.outputs))
          if (mapping.variable) this.store.setVariable(mapping.variable, outputs[key] ?? null);
        this.store.set(`ds.${id}`, { ...outputs, status: 'success', loading: false, error: null });
      }, `dataSource.${id}`);
      this.event('dataSource', 'completed', undefined, id, {
        durationMs: (this.ports.now?.() ?? Date.now()) - began,
      });
    } catch (error) {
      this.event(
        'dataSource',
        controller.signal.aborted ? 'cancelled' : 'failed',
        'VERBIS_DATASOURCE_FAILED',
        id,
        { durationMs: (this.ports.now?.() ?? Date.now()) - began },
      );
      if (this.calls.get(id) === controller)
        this.store.set(`ds.${id}`, {
          status: controller.signal.aborted && !timeoutState.expired ? 'idle' : 'error',
          loading: false,
          error: controller.signal.aborted && !timeoutState.expired ? null : 'runtime.dataError',
        });
      throw new RuntimeProblem(
        timeoutState.expired
          ? 'VERBIS_DATASOURCE_TIMEOUT'
          : controller.signal.aborted
            ? 'VERBIS_RUNTIME_CANCELLED'
            : error instanceof RuntimeProblem
              ? error.code
              : 'VERBIS_DATASOURCE_FAILED',
      );
    } finally {
      clearTimeout(timeout);
      parent.removeEventListener('abort', abort);
      this.lifetime.signal.removeEventListener('abort', abort);
      if (this.calls.get(id) === controller) this.calls.delete(id);
    }
  }
  actionOrigin(): string {
    const frame = this.frames.at(-1);
    return frame ? `flow:${frame.flow.id}/${frame.cursor}` : 'action';
  }
  startTimer(id: string): void {
    if (this.simulation && !this.simulationTimers) return;
    this.stopTimer(id);
    const generation = this.timerVersions.get(id) ?? 0;
    const pageId = this.store.get('runtime.page');
    if (typeof pageId !== 'string') throw new RuntimeProblem('VERBIS_PAGE_UNKNOWN');
    const timer = this.page(pageId).timers.find((t) => t.id === id);
    if (!timer) throw new RuntimeProblem('VERBIS_TIMER_UNKNOWN');
    const schedule = () => {
      this.timers.set(
        id,
        setTimeout(() => {
          this.timers.delete(id);
          void this.executor
            .execute(timer.onElapsed, this.lifetime.signal, `ui:timer:${pageId}:${timer.id}`)
            .then(() => {
              if (
                timer.repeat &&
                this.timerVersions.get(id) === generation &&
                !this.disposed &&
                this.store.get('runtime.page') === pageId
              )
                schedule();
            })
            .catch(() => {
              this.event('startTimer', 'failed', 'VERBIS_TIMER_FAILED');
            });
        }, timer.durationMs),
      );
    };
    schedule();
  }
  stopTimer(id: string): void {
    this.timerVersions.set(id, (this.timerVersions.get(id) ?? 0) + 1);
    const timer = this.timers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(id);
  }
  private clearTimers(): void {
    for (const id of this.timerVersions.keys()) this.stopTimer(id);
  }
  dispose(): void {
    this.disposed = true;
    this.lifetime.abort();
    this.executor.cancelAll();
    this.clearTimers();
    for (const c of this.calls.values()) c.abort();
    this.calls.clear();
    this.store.clearPaymentValues();
  }
  recordInput(input: PreviewStep): void {
    if (this.simulation) this.ports.simulationInput?.(input);
    else if (input.type === 'read')
      this.ports.telemetry?.({
        type: 'text.acknowledged',
        name: input.node,
        status: input.acknowledged ? 'success' : 'failure',
        durationMs: 0,
      });
  }
  /** A checkpoint restores state and flow position; it never replays external side effects. */
  checkpoint() {
    if (!this.simulation) throw new RuntimeProblem('VERBIS_PREVIEW_ONLY');
    const encode = (frame: FlowFrame) => ({
      flowId: frame.flow.id,
      cursor: frame.cursor,
      steps: frame.steps,
      traversals: [...frame.traversals],
    });
    return {
      store: this.store.checkpoint(),
      frames: this.frames.map(encode),
      history: this.history.map((entry) => ({
        page: entry.page,
        frames: entry.frames.map(encode),
      })),
      started: this.started,
      sequence: this.sequence,
    };
  }
  /** Restore into a fresh simulation. The host disposes the old runtime first. */
  restore(checkpoint: ReturnType<Runtime['checkpoint']>): void {
    if (!this.simulation || this.started) throw new RuntimeProblem('VERBIS_PREVIEW_ONLY');
    const decode = (frame: (typeof checkpoint.frames)[number]): FlowFrame => {
      const flow = [this.document.flow, ...this.document.subflows].find(
        (f) => f.id === frame.flowId,
      );
      if (!flow?.nodes.some((n) => n.id === frame.cursor))
        throw new RuntimeProblem('VERBIS_FLOW_NODE_UNKNOWN');
      return {
        flow,
        cursor: frame.cursor,
        steps: frame.steps,
        traversals: new Map(frame.traversals),
      };
    };
    this.frames = checkpoint.frames.map(decode);
    this.history = checkpoint.history.map((entry) => ({
      page: entry.page,
      frames: entry.frames.map(decode),
    }));
    this.started = checkpoint.started;
    this.sequence = checkpoint.sequence;
    this.store.restore(checkpoint.store);
    // Pending I/O and timers have been cancelled in the old runtime; no pending callback is replayed.
    for (const source of this.document.dataSources) {
      const state = this.store.get(`ds.${source.id}`);
      if (state && typeof state === 'object' && !Array.isArray(state) && state['loading'] === true)
        this.store.set(`ds.${source.id}`, { status: 'idle', loading: false, error: null });
    }
  }
  request(node: string): void {
    const walk = (nodes: readonly Node[]): boolean =>
      nodes.some((n) => (n.id === node && n.type === 'webService') || walk(n.children ?? []));
    if (!this.document.pages.some((p) => walk([this.page(p.id).layout])))
      throw new RuntimeProblem('VERBIS_NODE_UNKNOWN');
    this.store.set(
      `runtime.request.${node}`,
      (Number(this.store.get(`runtime.request.${node}`)) || 0) + 1,
    );
  }
  condition(condition?: Condition): boolean {
    return this.expressions.condition(condition);
  }
}
