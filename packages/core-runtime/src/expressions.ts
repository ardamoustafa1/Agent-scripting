import { compileExpression, extractDependencies, ruleToExpression } from '@verbis/expr';
import type { Condition, JsonValue, Node, ScriptDocument, Value } from '@verbis/script-schema';

import { RuntimeProblem } from './problem.js';

import type { RuntimeStore } from './store.js';

/** Compile once per runtime; rules are pure predicates and never run then/else implicitly. */
export class RuntimeExpressions {
  private dependencyCache = new Map<string, string[]>();
  private compiled = new Map<string, ReturnType<typeof compileExpression>>();
  constructor(
    readonly document: ScriptDocument,
    readonly store: RuntimeStore,
    private now: () => number = Date.now,
  ) {}
  source(condition: Condition): string {
    if ('$expr' in condition) return condition.$expr;
    const rule = this.document.rules.find((r) => r.id === condition.$rule);
    if (!rule) throw new RuntimeProblem('VERBIS_RULE_UNKNOWN');
    return ruleToExpression(rule.when);
  }
  dependenciesOf(source: string): string[] {
    let deps = this.dependencyCache.get(source);
    if (!deps) {
      deps = extractDependencies(source);
      this.dependencyCache.set(source, deps);
    }
    return deps;
  }
  evaluate(source: string): JsonValue {
    let compiled = this.compiled.get(source);
    if (!compiled) {
      compiled = compileExpression(source, {
        now: this.now,
        locale: this.store.locale.startsWith('en') ? 'en' : 'tr',
      });
      this.compiled.set(source, compiled);
    }
    return compiled.evaluate(this.store.context(this.dependenciesOf(source)));
  }
  condition(condition?: Condition): boolean {
    return condition === undefined || this.evaluate(this.source(condition)) === true;
  }
  value(value: Value): JsonValue {
    return value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      '$expr' in value &&
      typeof value.$expr === 'string'
      ? this.evaluate(value.$expr)
      : value;
  }
  map(values: Record<string, Value> = {}): Record<string, JsonValue> {
    return Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, this.value(value)]),
    );
  }
  dependencies(node: Node): string[] {
    const result = new Set<string>([`runtime.mask.${node.id}`, `runtime.errors.${node.id}`]);
    for (const binding of node.bindings) {
      for (const path of 'variable' in binding
        ? [`vars.${binding.variable}`]
        : this.dependenciesOf(binding.expression))
        result.add(path);
    }
    for (const condition of [node.visibleWhen, node.enabledWhen, node.requiredWhen]) {
      if (condition)
        for (const path of this.dependenciesOf(this.source(condition))) result.add(path);
    }
    if (node.type === 'webService' && typeof node.props['ds'] === 'string')
      result.add(`ds.${node.props['ds']}`);
    return [...result];
  }
  sensitivity(value: Value): 'public' | 'internal' | 'pii' | 'pci' {
    if (
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !('$expr' in value) ||
      typeof value.$expr !== 'string'
    )
      return 'public';
    const order = ['public', 'internal', 'pii', 'pci'] as const;
    let rank = 0;
    for (const dependency of this.dependenciesOf(value.$expr)) {
      for (const variable of this.document.variables) {
        if (
          dependency === 'vars' ||
          dependency === 'vars.*' ||
          dependency === `vars.${variable.key}` ||
          dependency.startsWith(`vars.${variable.key}.`)
        )
          rank = Math.max(rank, order.indexOf(this.store.classification(variable.key)));
      }
      if (dependency === 'ds' || dependency.startsWith('ds.')) {
        rank = Math.max(rank, 2);
        for (const ds of this.document.dataSources)
          for (const output of Object.values(ds.outputs)) {
            if (
              output.variable &&
              (dependency === 'ds' || dependency === 'ds.*' || dependency.startsWith(`ds.${ds.id}`))
            )
              rank = Math.max(rank, order.indexOf(this.store.classification(output.variable)));
          }
      }
      if (
        ['interaction', 'agent', 'campaign'].some(
          (root) => dependency === root || dependency.startsWith(`${root}.`),
        )
      )
        rank = Math.max(rank, 2);
    }
    return order[rank] ?? 'internal';
  }
  assertDisplay(source: string): void {
    for (const dependency of extractDependencies(source)) {
      for (const variable of this.document.variables) {
        if (
          this.store.classification(variable.key) === 'pci' &&
          (dependency === 'vars' ||
            dependency === 'vars.*' ||
            dependency === `vars.${variable.key}` ||
            dependency.startsWith(`vars.${variable.key}.`))
        )
          throw new RuntimeProblem('VERBIS_SENSITIVE_DISPLAY');
      }
      for (const ds of this.document.dataSources)
        for (const [name, output] of Object.entries(ds.outputs)) {
          if (
            this.document.variables.some(
              (v) => v.key === output.variable && this.store.classification(v.key) === 'pci',
            ) &&
            (dependency === 'ds' ||
              dependency === 'ds.*' ||
              dependency === `ds.${ds.id}` ||
              dependency === `ds.${ds.id}.*` ||
              dependency === `ds.${ds.id}.${name}` ||
              dependency.startsWith(`ds.${ds.id}.${name}.`))
          )
            throw new RuntimeProblem('VERBIS_SENSITIVE_DISPLAY');
        }
    }
  }
  /** Conservative sink policy: dynamic/root variable reads include all matching declarations. */
  assertSink(values: Record<string, Value>, diagnostic = false): void {
    for (const value of Object.values(values)) {
      if (
        value === null ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        !('$expr' in value) ||
        typeof value.$expr !== 'string'
      )
        continue;
      if (diagnostic && this.sensitivity(value) === 'pii')
        throw new RuntimeProblem('VERBIS_SENSITIVE_SINK');
      for (const dependency of extractDependencies(value.$expr)) {
        for (const variable of this.document.variables) {
          if (
            dependency === 'vars' ||
            dependency === 'vars.*' ||
            dependency === `vars.${variable.key}` ||
            dependency.startsWith(`vars.${variable.key}.`)
          ) {
            if (
              this.store.classification(variable.key) === 'pci' ||
              (diagnostic && this.store.classification(variable.key) === 'pii')
            )
              throw new RuntimeProblem('VERBIS_SENSITIVE_SINK');
          }
        }
        // Mapped outputs may be sensitive; only classified variable bindings can be used in sinks.
        if (dependency === 'ds' || dependency.startsWith('ds.'))
          throw new RuntimeProblem('VERBIS_SENSITIVE_SINK');
      }
    }
  }
}
