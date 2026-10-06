import { z } from 'zod';

import {
  ConditionSchema,
  I18nKeySchema,
  NodeIdSchema,
  type JsonValue,
  type Node,
} from '@verbis/script-schema';

import { abortable, checkAbort, RuntimeProblem } from './problem.js';

import type { Runtime } from './runtime.js';

export const FieldValidationSchema = z.strictObject({
  required: z.boolean().optional(),
  validation: z
    .array(z.strictObject({ when: ConditionSchema, messageKey: I18nKeySchema }))
    .max(32)
    .optional(),
});
export const FieldIssueSchema = z.strictObject({ node: NodeIdSchema, messageKey: I18nKeySchema });
export type FieldIssue = z.infer<typeof FieldIssueSchema>;
export type ServerValidationHook = (request: {
  pageIds: readonly string[];
  signal: AbortSignal;
}) => Promise<unknown>;
export type FieldValidationHook = (
  node: Node,
  value: JsonValue,
  signal: AbortSignal,
) => Promise<readonly FieldIssue[]>;
async function hookResult(work: () => Promise<unknown>, signal: AbortSignal): Promise<unknown> {
  try {
    return await abortable(work(), signal);
  } catch (error) {
    throw error instanceof RuntimeProblem
      ? error
      : new RuntimeProblem('VERBIS_VALIDATION_SERVICE_FAILED');
  }
}
export class ValidationEngine {
  constructor(
    private runtime: Runtime,
    private server?: ServerValidationHook,
    private custom?: FieldValidationHook,
  ) {}
  async field(node: Node, signal = this.runtime.signal, active = true): Promise<FieldIssue[]> {
    checkAbort(signal);
    const { expressions, store } = this.runtime;
    if (
      !active ||
      !expressions.condition(node.visibleWhen) ||
      !expressions.condition(node.enabledWhen)
    )
      return [];
    const rules = FieldValidationSchema.parse({
      required: node.props['required'],
      validation: node.props['validation'],
    });
    const binding = node.bindings.find((b) => b.prop === 'value' || b.prop === 'checked');
    const value =
      binding && 'variable' in binding
        ? store.variable(binding.variable)
        : binding && 'expression' in binding
          ? expressions.evaluate(binding.expression)
          : (node.props['value'] ?? node.props['checked'] ?? null);
    const required = node.requiredWhen
      ? expressions.condition(node.requiredWhen)
      : rules.required === true;
    const issues: FieldIssue[] = (
      this.runtime.registry.get(node.type).validate?.(node, store) ?? []
    ).map((issue) => ({ node: node.id, messageKey: issue.messageKey }));
    if (
      required &&
      (value === null ||
        value === false ||
        (typeof value === 'string' && value.trim() === '') ||
        (Array.isArray(value) && value.length === 0))
    )
      issues.push({ node: node.id, messageKey: 'runtime.required' });
    for (const rule of rules.validation ?? [])
      if (!expressions.condition(rule.when))
        issues.push({ node: node.id, messageKey: rule.messageKey });
    if (this.custom)
      issues.push(
        ...z
          .array(FieldIssueSchema)
          .parse(
            await hookResult(
              () => (this.custom ? this.custom(node, value, signal) : Promise.resolve([])),
              signal,
            ),
          ),
      );
    return issues;
  }
  async page(page: string, signal = this.runtime.signal): Promise<FieldIssue[]> {
    return this.pages([page], signal);
  }
  async script(signal = this.runtime.signal): Promise<FieldIssue[]> {
    return this.pages(
      this.runtime.document.pages.map((p) => p.id),
      signal,
    );
  }
  private async pages(ids: readonly string[], signal: AbortSignal): Promise<FieldIssue[]> {
    const issues: FieldIssue[] = [],
      nodes = new Set<string>();
    const walk = async (node: Node, active: boolean): Promise<void> => {
      nodes.add(node.id);
      const visible =
        active &&
        this.runtime.expressions.condition(node.visibleWhen) &&
        this.runtime.expressions.condition(node.enabledWhen);
      issues.push(...(await this.field(node, signal, visible)));
      for (const child of node.children ?? []) await walk(child, visible);
    };
    for (const id of ids) {
      const page = this.runtime.document.pages.find((p) => p.id === id);
      if (!page) throw new RuntimeProblem('VERBIS_PAGE_UNKNOWN');
      await walk(this.runtime.page(id).layout, true);
    }
    if (this.server)
      issues.push(
        ...z
          .array(FieldIssueSchema)
          .parse(
            await hookResult(
              () => (this.server ? this.server({ pageIds: ids, signal }) : Promise.resolve([])),
              signal,
            ),
          ),
      );
    checkAbort(signal);
    if (
      issues.some(
        (issue) =>
          !nodes.has(issue.node) ||
          (issue.messageKey !== 'runtime.required' &&
            !['components.invalid', 'components.mustRead', 'components.signatureRequired'].includes(
              issue.messageKey,
            ) &&
            this.runtime.document.i18n.messages[this.runtime.document.i18n.defaultLocale]?.[
              issue.messageKey
            ] === undefined),
      )
    )
      throw new RuntimeProblem('VERBIS_VALIDATION_RESPONSE');
    this.runtime.store.batch(() => {
      for (const id of nodes)
        this.runtime.store.set(
          `runtime.errors.${id}`,
          issues.filter((i) => i.node === id).map((i) => i.messageKey),
        );
    });
    return issues;
  }
}
