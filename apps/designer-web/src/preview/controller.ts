import {
  Runtime,
  mockDataSource,
  type RuntimeSessionEvent,
  type DataSourceRequest,
} from '@verbis/core-runtime';
import {
  TestScenarioSchema,
  PreviewContextSchema,
  type ScriptDocument,
  type TestScenario,
  type PreviewStep,
} from '@verbis/script-schema';

import { editorRegistry } from '../editor/store.js';

type Checkpoint = ReturnType<Runtime['checkpoint']>;
export interface TimelineEntry {
  id: number;
  event: RuntimeSessionEvent;
  snapshot?: Checkpoint;
  steps: number;
  outcome?: string | undefined;
}
export class PreviewController {
  runtime!: Runtime;
  readonly initial: TestScenario['context'];
  readonly inputs: PreviewStep[] = [];
  readonly timeline: TimelineEntry[] = [];
  readonly visitedNodes = new Set<string>();
  readonly visitedEdges = new Set<string>();
  outcome: string | undefined;
  currentNode: string | undefined;
  liveUsed = false;
  branched = false;
  private listeners = new Set<() => void>();
  private revision = 0;
  private generation = 0;
  private queued = false;
  private offStore: (() => void) | undefined;
  private nextId = 0;
  private closed = false;
  error: string | undefined;
  constructor(
    readonly document: ScriptDocument,
    context: TestScenario['context'],
    readonly mocks: TestScenario['dataSources'],
    private readonly live?: (request: DataSourceRequest) => Promise<unknown>,
    readonly liveSources: ReadonlySet<string> = new Set(),
  ) {
    this.initial = PreviewContextSchema.parse(context);
    this.create();
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.revision;
  notify() {
    if (this.queued || this.closed) return;
    this.queued = true;
    // Completion events fire before the executor's finally block clears busy.
    // Publish on the next task so controls observe that settled activity state.
    setTimeout(() => {
      this.queued = false;
      if (this.closed) return;
      this.revision++;
      for (const listener of this.listeners) listener();
    }, 0);
  }
  private create(snapshot?: Checkpoint) {
    const generation = ++this.generation;
    const isCurrent = () => generation === this.generation && !this.closed;
    this.runtime = new Runtime({
      document: this.document,
      session: this.initial,
      registry: editorRegistry,
      simulation: true,
      ports: {
        sessionEvent: (event) => {
          if (!isCurrent()) return;
          if (event.action === 'flow' && event.node) {
            this.currentNode = event.node;
            this.visitedNodes.add(event.node);
          }
          if (event.edge) this.visitedEdges.add(event.edge);
          const entry: TimelineEntry = {
            id: ++this.nextId,
            event,
            steps: this.inputs.length,
            outcome: this.outcome,
          };
          this.timeline.push(entry);
          if (this.timeline.length > 1000) this.timeline.shift();
          // Snapshots are bounded and never written to browser storage or remote telemetry.
          if (event.phase === 'completed' || event.action === 'page' || event.phase === 'waiting')
            entry.snapshot = this.runtime.checkpoint();
          const snapshots = this.timeline.filter((row) => row.snapshot);
          if (snapshots.length > 100) delete snapshots[0]?.snapshot;
          this.notify();
        },
        simulationInput: (input) => {
          if (isCurrent()) {
            if (this.inputs.length < 500) this.inputs.push(structuredClone(input));
            else this.error = 'VERBIS_PREVIEW_RECORDING_LIMIT';
            this.notify();
          }
        },
      },
      simulationPorts: {
        dataSource: async (request) => {
          if (this.liveSources.has(request.id)) {
            if (!this.live) throw new Error('VERBIS_AUTHZ_FORBIDDEN');
            this.liveUsed = true;
            return this.live(request);
          }
          return mockDataSource(this.mocks)(request);
        },
        command: (action) => {
          if (isCurrent() && action.type === 'submitOutcome') {
            this.outcome = action.outcome;
            this.notify();
          }
          return Promise.resolve();
        },
      },
    });
    if (snapshot) this.runtime.restore(snapshot);
    this.runtime.executor.debugger.resume();
    this.offStore = this.runtime.store.subscribe(['*'], () => {
      if (isCurrent()) this.notify();
    });
  }
  start() {
    void this.runtime.start().catch(() => {
      if (!this.closed) {
        this.error = 'VERBIS_PREVIEW_START_FAILED';
        this.notify();
      }
    });
  }
  pause() {
    this.runtime.executor.debugger.pause();
    this.notify();
  }
  resume() {
    this.runtime.executor.debugger.resume();
    this.notify();
  }
  step() {
    this.runtime.executor.debugger.step();
    this.notify();
  }
  jump(id: number) {
    const row = this.timeline.find((entry) => entry.id === id);
    if (!row?.snapshot) return;
    const snapshot = structuredClone(row.snapshot);
    const breakpoints = [...this.runtime.executor.debugger.breakpoints];
    ++this.generation;
    this.offStore?.();
    this.runtime.dispose();
    this.inputs.splice(row.steps);
    this.timeline.splice(this.timeline.indexOf(row) + 1);
    this.visitedNodes.clear();
    this.visitedEdges.clear();
    for (const entry of this.timeline) {
      if (entry.event.action === 'flow' && entry.event.node)
        this.visitedNodes.add(entry.event.node);
      if (entry.event.edge) this.visitedEdges.add(entry.event.edge);
    }
    this.currentNode = this.timeline
      .filter((entry) => entry.event.action === 'flow' && entry.event.node)
      .at(-1)?.event.node;
    this.outcome = row.outcome;
    this.error = undefined;
    this.branched = true;
    this.create(snapshot);
    for (const key of breakpoints) this.runtime.executor.debugger.breakpoints.add(key);
    this.pause();
  }
  scenario(name: string): TestScenario {
    if (this.liveUsed || this.branched || this.error || this.runtime.executor.busy)
      throw new Error('VERBIS_PREVIEW_SYNTHETIC_ONLY');
    const sensitive = new Set(
      this.document.variables
        .filter((v) => ['pii', 'pci'].includes(this.runtime.store.classification(v.key)))
        .map((v) => v.key),
    );
    if (
      Object.keys(this.initial.variables).some((key) => sensitive.has(key)) ||
      this.inputs.some((input) => input.type === 'variable' && sensitive.has(input.variable))
    )
      throw new Error('VERBIS_PREVIEW_SYNTHETIC_ONLY');
    const page = this.runtime.store.get('runtime.page');
    return TestScenarioSchema.parse({
      id: `scenario${crypto.randomUUID().replaceAll('-', '')}`,
      name,
      synthetic: true,
      context: this.initial,
      dataSources: this.mocks,
      steps: this.inputs,
      expected: {
        ...(this.outcome ? { outcome: this.outcome } : {}),
        ...(typeof page === 'string' ? { page } : {}),
        ended: this.runtime.store.get('runtime.ended') === true,
        variables: Object.fromEntries(
          [
            ...new Set(
              this.inputs.flatMap((input) => (input.type === 'variable' ? [input.variable] : [])),
            ),
          ].map((key) => [key, this.runtime.store.variable(key)]),
        ),
      },
    });
  }
  dispose() {
    this.closed = true;
    ++this.generation;
    this.offStore?.();
    this.runtime.dispose();
    this.timeline.splice(0);
    this.inputs.splice(0);
    this.listeners.clear();
  }
}
