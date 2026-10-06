import { z } from 'zod';

import {
  JsonValueSchema,
  literalMatchesType,
  type JsonValue,
  type ScriptDocument,
} from '@verbis/script-schema';

import { RuntimeProblem } from './problem.js';

export const SessionStateSchema = z.strictObject({
  variables: z.record(z.string(), JsonValueSchema).default({}),
  interaction: z.record(z.string(), JsonValueSchema).default({}),
  agent: z.record(z.string(), JsonValueSchema).default({}),
  campaign: z.record(z.string(), JsonValueSchema).default({}),
  const: z.record(z.string(), JsonValueSchema).default({}),
  locale: z.string().min(2).max(32).default('tr'),
});
export type SessionState = z.input<typeof SessionStateSchema>;
export interface DataState {
  status: 'idle' | 'loading' | 'success' | 'error';
  loading: boolean;
  error: string | null;
  [output: string]: JsonValue;
}
export function overlaps(left: string, right: string): boolean {
  const a = left.split('.'),
    b = right.split('.');
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] === '*' || b[i] === '*') return true;
    if (a[i] !== b[i]) return false;
  }
  return true;
}
function freeze(value: JsonValue): JsonValue {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
/** Immutable JSON values, indexed subscriptions, batched publication. No React dependency. */
export class RuntimeStore {
  private values = new Map<string, JsonValue>();
  private subscriptions = new Map<string, Set<() => void>>();
  private versions = new Map<string, number>();
  private pending = new Set<string>();
  private depth = 0;
  changeSource: string | undefined;
  private sensitivities = new Map<string, 'public' | 'internal' | 'pii' | 'pci'>();
  private currentLocale: string;
  readonly contextRoots: Record<string, JsonValue>;
  constructor(
    readonly document: ScriptDocument,
    session: SessionState = {},
  ) {
    const parsed = SessionStateSchema.parse(session);
    this.currentLocale = parsed.locale;
    this.contextRoots = {
      interaction: freeze(parsed.interaction),
      agent: freeze(parsed.agent),
      campaign: freeze(parsed.campaign),
      const: freeze(parsed.const),
    };
    for (const key of Object.keys(parsed.variables)) {
      if (!document.variables.some((v) => v.key === key))
        throw new RuntimeProblem('VERBIS_VARIABLE_UNKNOWN');
    }
    for (const variable of document.variables) {
      const sourced = variable.source
        ?.split('.')
        .reduce<JsonValue>(
          (value, part) =>
            value !== null && typeof value === 'object' && !Array.isArray(value)
              ? (value[part] ?? null)
              : null,
          this.contextRoots,
        );
      const value = Object.hasOwn(parsed.variables, variable.key)
        ? (parsed.variables[variable.key] ?? null)
        : (sourced ?? variable.default ?? null);
      if (!literalMatchesType(variable, value)) throw new RuntimeProblem('VERBIS_VARIABLE_TYPE');
      this.values.set(`vars.${variable.key}`, freeze(value));
      this.sensitivities.set(
        variable.key,
        variable.pii && variable.classification !== 'pci' ? 'pii' : variable.classification,
      );
    }
    for (const ds of document.dataSources)
      this.values.set(`ds.${ds.id}`, { status: 'idle', loading: false, error: null });
    this.values.set('runtime.page', null);
    this.values.set('runtime.modal', null);
  }
  get locale(): string {
    return this.currentLocale;
  }
  setLocale(locale: string): void {
    this.currentLocale = z.string().min(2).max(32).parse(locale);
    this.set('runtime.locale', this.currentLocale);
  }
  get(path: string): JsonValue {
    return this.values.get(path) ?? null;
  }
  variable(key: string): JsonValue {
    return this.get(`vars.${key}`);
  }
  classification(key: string): 'public' | 'internal' | 'pii' | 'pci' {
    return this.sensitivities.get(key) ?? 'internal';
  }
  setVariable(
    key: string,
    input: unknown,
    inherited: 'public' | 'internal' | 'pii' | 'pci' = 'public',
  ): void {
    const definition = this.document.variables.find((v) => v.key === key);
    if (!definition) throw new RuntimeProblem('VERBIS_VARIABLE_UNKNOWN');
    if (definition.scope === 'global') throw new RuntimeProblem('VERBIS_VARIABLE_READONLY');
    const value = JsonValueSchema.parse(input);
    if (!literalMatchesType(definition, value)) throw new RuntimeProblem('VERBIS_VARIABLE_TYPE');
    const order = ['public', 'internal', 'pii', 'pci'];
    const declared =
      definition.pii && definition.classification !== 'pci' ? 'pii' : definition.classification;
    const previousClassification = this.classification(key);
    this.sensitivities.set(
      key,
      order[
        Math.max(
          order.indexOf(inherited),
          order.indexOf(declared),
          order.indexOf(previousClassification),
        )
      ] as 'public' | 'internal' | 'pii' | 'pci',
    );
    if (
      previousClassification !== this.classification(key) &&
      Object.is(this.variable(key), value)
    ) {
      this.pending.add(`vars.${key}`);
      if (this.depth === 0) this.publish();
    }
    this.set(`vars.${key}`, value);
  }
  /** Internal state only. Hosts should mutate variables through setVariable. */
  set(path: string, value: JsonValue): void {
    if (Object.is(this.values.get(path), value)) return;
    this.values.set(path, freeze(value));
    this.pending.add(path);
    if (this.depth === 0) this.publish();
  }
  batch<T>(run: () => T, source?: string): T {
    const previous = this.changeSource;
    if (source !== undefined) this.changeSource = source;
    this.depth++;
    try {
      return run();
    } finally {
      if (--this.depth === 0) this.publish();
      this.changeSource = previous;
    }
  }
  private publish(): void {
    const listeners = new Set<() => void>();
    const changed = [...this.pending];
    this.pending.clear();
    for (const dependency of this.versions.keys()) {
      if (changed.some((path) => overlaps(path, dependency))) {
        this.versions.set(dependency, (this.versions.get(dependency) ?? 0) + 1);
        for (const listener of this.subscriptions.get(dependency) ?? []) listeners.add(listener);
      }
    }
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        /* Isolate consumers; never expose values in diagnostics. */
      }
    }
  }
  subscribe(dependencies: readonly string[], listener: () => void): () => void {
    for (const path of new Set(dependencies)) {
      if (!this.versions.has(path)) this.versions.set(path, 0);
      const group = this.subscriptions.get(path) ?? new Set();
      group.add(listener);
      this.subscriptions.set(path, group);
    }
    return () => {
      for (const path of dependencies) {
        const group = this.subscriptions.get(path);
        group?.delete(listener);
        if (group?.size === 0) this.subscriptions.delete(path);
      }
    };
  }
  revision(dependencies: readonly string[]): string {
    return dependencies
      .map((path) => {
        if (!this.versions.has(path)) this.versions.set(path, 0);
        return this.versions.get(path) ?? 0;
      })
      .join(':');
  }
  context(dependencies?: readonly string[]): Record<string, JsonValue> {
    const vars: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    const ds: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    const entries =
      dependencies === undefined ||
      dependencies.some(
        (path) => path === 'vars' || path === 'vars.*' || path === 'ds' || path === 'ds.*',
      )
        ? this.values.entries()
        : new Set(dependencies.map((path) => path.split('.').slice(0, 2).join('.'))).values();
    for (const entry of entries) {
      const [path, value] = typeof entry === 'string' ? [entry, this.get(entry)] : entry;
      if (path.startsWith('vars.')) vars[path.slice(5)] = value;
      if (path.startsWith('ds.')) ds[path.slice(3)] = value;
    }
    return { ...this.contextRoots, vars, ds };
  }
  /** Drop retained payment values when a host closes its runtime session. */
  clearPaymentValues(): void {
    this.batch(() => {
      for (const variable of this.document.variables)
        if (this.classification(variable.key) === 'pci') this.set(`vars.${variable.key}`, null);
    });
  }
  /** In-memory simulation checkpoints only. Retains classifications and immutable contexts. */
  checkpoint(): {
    values: [string, JsonValue][];
    sensitivities: [string, 'public' | 'internal' | 'pii' | 'pci'][];
  } {
    return structuredClone({ values: [...this.values], sensitivities: [...this.sensitivities] });
  }
  restore(checkpoint: ReturnType<RuntimeStore['checkpoint']>): void {
    this.batch(() => {
      const next = new Map(checkpoint.values);
      for (const path of new Set([...this.values.keys(), ...next.keys()]))
        this.set(path, next.get(path) ?? null);
      this.sensitivities = new Map(checkpoint.sensitivities);
    });
  }
  resetPageVariables(): void {
    this.batch(() => {
      for (const v of this.document.variables)
        if (v.scope === 'page') this.setVariable(v.key, v.default ?? null);
    });
  }
}
