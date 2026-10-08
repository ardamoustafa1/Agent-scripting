import { Runtime, mockDataSource, type SessionState } from '@verbis/core-runtime';
import {
  PreviewMockSchema,
  literalMatchesType,
  type JsonValue,
  type ScriptDocument,
} from '@verbis/script-schema';

import { editorRegistry } from './store.js';

/** How the last document change reached the live agent view. */
export type LoadResult = 'started' | 'reloaded' | 'restarted' | 'failed';

/**
 * Live agent view (DIFFERENTIATORS A1): an interactive simulation of the draft that survives
 * edits. Each edit builds a fresh runtime and carries the agent's position and the values they
 * entered, without replaying flow actions, data source calls or timers. Purely in memory: no
 * telemetry, no storage, mocked data sources.
 */
export class LiveSession {
  runtime: Runtime | null = null;
  result: LoadResult = 'started';
  /** Duration of the last load, for performance budgets (DIFFERENTIATORS §0.1). */
  loadMs = 0;
  private document: ScriptDocument | null = null;
  private listeners = new Set<() => void>();
  private offStore: (() => void) | undefined;
  private revision = 0;

  constructor(
    private locale: string,
    private readonly now: () => number = () => performance.now(),
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.revision;

  /** Apply a new document, keeping the agent where they are whenever that is still valid. */
  load(document: ScriptDocument): LoadResult {
    const started = this.now();
    const previous = this.runtime;
    const carried = previous && this.document ? carry(previous, this.document, document) : null;
    this.replace(null);
    let result: LoadResult = 'failed';
    try {
      const runtime = this.create(document, carried?.variables ?? {});
      // Simulations start paused for the debugger; the live view always runs.
      runtime.executor.debugger.resume();
      this.replace(runtime);
      result = 'started';
      if (carried?.page) {
        try {
          runtime.resume(carried.page, carried.history);
          result = 'reloaded';
        } catch {
          // The page left the flow: begin again rather than show an unreachable screen.
          result = 'restarted';
        }
      }
      if (result !== 'reloaded') this.begin(runtime);
    } catch {
      this.replace(null);
    }
    this.document = document;
    this.result = result;
    this.loadMs = this.now() - started;
    this.notify();
    return result;
  }

  /** Show a page without running its entry actions (designer navigated in the editor). */
  show(pageId: string): void {
    const runtime = this.runtime;
    if (!runtime || runtime.store.get('runtime.page') === pageId) return;
    try {
      runtime.resynchronize(pageId);
    } catch {
      /* Pages outside the flow stay as they are; the canvas still shows them. */
    }
  }

  /** Rendered text is resolved per runtime, so a new locale is a state-preserving reload. */
  setLocale(locale: string): void {
    if (locale === this.locale) return;
    this.locale = locale;
    if (this.document && this.runtime) this.load(this.document);
  }

  /** Discard entered values and run the flow from its start. */
  restart(): void {
    const document = this.document;
    if (!document) return;
    this.document = null;
    this.replace(null);
    this.load(document);
  }

  dispose(): void {
    this.replace(null);
    this.listeners.clear();
  }

  private create(document: ScriptDocument, variables: Record<string, JsonValue>): Runtime {
    const session: SessionState = { locale: this.locale, variables };
    return new Runtime({
      document,
      session,
      registry: editorRegistry,
      simulation: true,
      ports: {
        sessionEvent: () => {
          /* The live view deliberately emits no telemetry. */
        },
      },
      simulationPorts: {
        dataSource: mockDataSource(
          Object.fromEntries(
            document.dataSources.map((source) => [
              source.id,
              PreviewMockSchema.parse({
                outputs: Object.fromEntries(Object.keys(source.outputs).map((key) => [key, null])),
              }),
            ]),
          ),
        ),
        command: () => Promise.resolve(),
      },
    });
  }

  private begin(runtime: Runtime): void {
    void runtime.start().catch(() => {
      if (this.runtime === runtime) {
        this.result = 'failed';
        this.notify();
      }
    });
  }

  private replace(runtime: Runtime | null): void {
    this.offStore?.();
    this.offStore = undefined;
    this.runtime?.dispose();
    this.runtime = runtime;
    if (runtime)
      this.offStore = runtime.store.subscribe(['runtime.page'], () => {
        this.notify();
      });
  }

  private notify(): void {
    this.revision++;
    for (const listener of this.listeners) listener();
  }
}

interface Carried {
  page: string | null;
  history: string[];
  variables: Record<string, JsonValue>;
}

/**
 * What survives an edit: values the agent changed (not untouched defaults, so a new default shows
 * at once), for variables that still exist with a compatible type, plus the page and history.
 */
export function carry(runtime: Runtime, before: ScriptDocument, after: ScriptDocument): Carried {
  const variables: Record<string, JsonValue> = {};
  for (const variable of after.variables) {
    if (variable.scope === 'global') continue;
    const old = before.variables.find((v) => v.key === variable.key);
    if (!old) continue;
    const value = runtime.store.variable(variable.key);
    const untouched = JSON.stringify(value) === JSON.stringify(old.default ?? null);
    if (untouched || value === null || !literalMatchesType(variable, value)) continue;
    variables[variable.key] = value;
  }
  const pages = new Set(after.pages.map((page) => page.id));
  const current = runtime.store.get('runtime.page');
  const page = typeof current === 'string' && pages.has(current) ? current : null;
  const checkpoint = runtime.simulation ? runtime.checkpoint() : undefined;
  const history = (checkpoint?.history ?? [])
    .map((entry) => entry.page)
    .filter((id) => pages.has(id));
  return { page, history, variables };
}
