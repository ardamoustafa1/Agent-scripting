import { z } from 'zod';

import { ActionSchema, type Action, type ActionInput } from '@verbis/script-schema';

import { abortable, checkAbort, RuntimeProblem } from './problem.js';

import type { Runtime } from './runtime.js';

interface Execution {
  signal: AbortSignal;
  count: number;
  level: number;
}
/** FIFO step permits. Each primitive/group action has its own debugger checkpoint. */
export class SimulationController {
  private waiters: {
    resolve: () => void;
    reject: (error: RuntimeProblem) => void;
    signal: AbortSignal;
    abort: () => void;
  }[] = [];
  private permits = 0;
  private running = false;
  readonly breakpoints = new Set<string>();
  get paused(): boolean {
    return !this.running;
  }
  step(): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.signal.removeEventListener('abort', waiter.abort);
      waiter.resolve();
    } else this.permits++;
  }
  resume(): void {
    this.running = true;
    while (this.waiters.length) this.step();
  }
  pause(): void {
    this.running = false;
    this.permits = 0;
  }
  async checkpoint(signal: AbortSignal, keys: readonly string[] = []): Promise<void> {
    checkAbort(signal);
    if (this.running && keys.some((key) => this.breakpoints.has(key))) this.pause();
    if (this.running) return;
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        signal,
        abort: () => {
          this.waiters = this.waiters.filter((w) => w !== waiter);
          reject(new RuntimeProblem('VERBIS_RUNTIME_CANCELLED'));
        },
      };
      this.waiters.push(waiter);
      signal.addEventListener('abort', waiter.abort, { once: true });
    });
  }
}
export class ActionExecutor {
  private executions = new WeakMap<AbortSignal, Execution>();
  private active = new Set<AbortController>();
  readonly debugger = new SimulationController();
  get busy(): boolean {
    return this.active.size > 0;
  }
  constructor(readonly runtime: Runtime) {}
  cancelAll(): void {
    for (const controller of this.active) controller.abort();
  }
  async execute(
    input: readonly ActionInput[],
    signal?: AbortSignal,
    origin = 'action',
  ): Promise<void> {
    if (origin === 'action') origin = this.runtime.actionOrigin();
    const actions = z.array(ActionSchema).max(10_000).parse(input);
    if (this.runtime.simulation && origin.startsWith('ui:'))
      this.runtime.recordInput({
        type: 'actions',
        actions,
        ...(origin.startsWith('ui:source:') ? { ignoreError: true } : {}),
      });
    const controller = new AbortController();
    const abort = () => {
      controller.abort();
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted || this.runtime.signal.aborted) controller.abort();
    this.runtime.signal.addEventListener('abort', abort, { once: true });
    this.active.add(controller);
    const parent = signal ? this.executions.get(signal) : undefined;
    let localCount = 0;
    const execution: Execution = {
      signal: controller.signal,
      level: (parent?.level ?? -1) + 1,
      get count() {
        return parent?.count ?? localCount;
      },
      set count(value: number) {
        if (parent) parent.count = value;
        else localCount = value;
      },
    };
    this.executions.set(controller.signal, execution);
    try {
      await this.list(actions, execution, execution.level, origin);
    } finally {
      this.active.delete(controller);
      this.executions.delete(controller.signal);
      signal?.removeEventListener('abort', abort);
      this.runtime.signal.removeEventListener('abort', abort);
    }
  }
  private async list(
    actions: readonly Action[],
    execution: Execution,
    depth: number,
    origin: string,
  ): Promise<void> {
    if (depth > 32) throw new RuntimeProblem('VERBIS_ACTION_LIMIT');
    for (const [index, action] of actions.entries())
      await this.run(action, execution, depth, `${origin}/${index}`);
  }
  private async run(
    action: Action,
    execution: Execution,
    depth: number,
    path: string,
  ): Promise<void> {
    checkAbort(execution.signal);
    if (depth > 32) throw new RuntimeProblem('VERBIS_ACTION_LIMIT');
    if (++execution.count > 10_000) throw new RuntimeProblem('VERBIS_ACTION_LIMIT');
    const { runtime } = this;
    try {
      if (runtime.simulation) {
        runtime.event(action.type, 'waiting', undefined, undefined, { path });
        await this.debugger.checkpoint(execution.signal, [path, `action:${action.type}`]);
      }
      const began = runtime.ports.now?.() ?? Date.now();
      runtime.event(action.type, 'started', undefined, undefined, { path });
      await this.dispatch(action, execution, depth, path);
      checkAbort(execution.signal);
      runtime.event(action.type, 'completed', undefined, undefined, {
        path,
        durationMs: (runtime.ports.now?.() ?? Date.now()) - began,
      });
    } catch (error) {
      const code = error instanceof RuntimeProblem ? error.code : 'VERBIS_ACTION_FAILED';
      runtime.event(
        action.type,
        execution.signal.aborted ? 'cancelled' : 'failed',
        code,
        undefined,
        { path },
      );
      throw new RuntimeProblem(code);
    }
  }
  private async dispatch(
    action: Action,
    execution: Execution,
    depth: number,
    path: string,
  ): Promise<void> {
    const r = this.runtime,
      e = r.expressions,
      signal = execution.signal;
    const children = (actions: readonly Action[]) => this.list(actions, execution, depth + 1, path);
    switch (action.type) {
      case 'setVariable':
        r.store.setVariable(action.variable, e.value(action.value), e.sensitivity(action.value));
        return;
      case 'callDataSource':
        try {
          await r.callDataSource(action.dataSource, action.inputs, signal);
        } catch (error) {
          if (signal.aborted || !action.onError) throw error;
          r.ports.dataSourceErrorHandled?.(action.dataSource);
          await children(action.onError);
          return;
        }
        await children(action.onSuccess ?? []);
        return;
      case 'navigate':
        await r.navigate(action.page, signal);
        return;
      case 'next':
        await r.next(signal);
        return;
      case 'back':
        await r.back(signal);
        return;
      case 'showToast':
        e.assertSink(action.params ?? {});
        r.ports.toast?.(r.message(action.messageKey, e.map(action.params)), action.tone);
        return;
      case 'openModal':
        r.page(action.page);
        r.store.set('runtime.modal', action.page);
        return;
      case 'closeModal':
        r.store.set('runtime.modal', null);
        return;
      case 'validatePage': {
        const page = action.page ?? r.store.get('runtime.page');
        if (typeof page !== 'string') throw new RuntimeProblem('VERBIS_PAGE_UNKNOWN');
        if ((await r.validation.page(page, signal)).length) {
          if (action.onInvalid) await children(action.onInvalid);
          // Validation prevents the remainder of the action chain from submitting/navigating.
          throw new RuntimeProblem('VERBIS_VALIDATION_FAILED');
        }
        return;
      }
      case 'submitOutcome': {
        const early = action.completion === 'early';
        if (
          !early &&
          r.document.pages.some(
            (page) => page.mandatory && r.store.get(`runtime.visited.${page.id}`) !== true,
          )
        )
          throw new RuntimeProblem('VERBIS_MANDATORY_PAGE_UNVISITED');
        if ((await (early ? r.validation.visited(signal) : r.validation.script(signal))).length)
          throw new RuntimeProblem('VERBIS_VALIDATION_FAILED');
        const values = action.notes === undefined ? {} : { notes: action.notes };
        e.assertSink(values);
        await r.command(action, e.map(values), signal);
        return;
      }
      case 'setDisposition':
        await r.command(action, {}, signal);
        return;
      case 'writeBackToPlatform':
        e.assertSink(action.attributes);
        await r.command(action, e.map(action.attributes), signal);
        return;
      case 'transferHint':
        await r.command(action, {}, signal);
        return;
      case 'emitEvent':
        e.assertSink(action.payload ?? {}, true);
        await r.command(action, e.map(action.payload), signal);
        return;
      case 'logEvent':
        e.assertSink(action.data ?? {}, true);
        await r.command(action, e.map(action.data), signal);
        return;
      case 'runSubflow':
        await r.runSubflow(action.flow, signal);
        return;
      case 'conditional':
        await children(e.condition(action.if) ? action.then : (action.else ?? []));
        return;
      case 'sequence':
        await children(action.actions);
        return;
      case 'parallel': {
        const group = new AbortController();
        const abort = () => {
          group.abort();
        };
        signal.addEventListener('abort', abort, { once: true });
        const childExecution = {
          get count() {
            return execution.count;
          },
          set count(value: number) {
            execution.count = value;
          },
          signal: group.signal,
          level: depth + 1,
        };
        this.executions.set(group.signal, childExecution);
        try {
          await abortable(
            Promise.all(
              action.actions.map((child, index) =>
                this.run(child, childExecution, depth + 1, `${path}/parallel/${index}`),
              ),
            ).then(() => undefined),
            signal,
          );
        } catch (error) {
          group.abort();
          throw error;
        } finally {
          signal.removeEventListener('abort', abort);
          this.executions.delete(group.signal);
        }
        return;
      }
      case 'startTimer':
        r.startTimer(action.timer);
        return;
      case 'stopTimer':
        r.stopTimer(action.timer);
        return;
      case 'maskField':
        r.store.set(`runtime.mask.${action.node}`, action.masked);
        return;
      default: {
        const exhaustive: never = action;
        throw new RuntimeProblem(`VERBIS_ACTION_UNKNOWN_${String(exhaustive)}`);
      }
    }
  }
}
