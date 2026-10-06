import { RuntimeProblem, type RendererProps } from '@verbis/core-runtime';
import { extractDependencies } from '@verbis/expr';

import { GuestMessageSchema, PluginManifestSchema, type PluginManifest } from './protocol.js';

import type { z } from 'zod';
/** Pure protocol firewall. A MessagePort is the capability; no global window message dispatch. */
export class PluginBridge {
  private last = 0;
  private windowStart = 0;
  private count = 0;
  readonly manifest: PluginManifest;
  constructor(
    manifest: unknown,
    private component: RendererProps,
    private schema: z.ZodType<Record<string, unknown>>,
    private resize: (height: number) => void,
    private now: () => number = Date.now,
  ) {
    this.manifest = PluginManifestSchema.parse(manifest);
  }
  update(component: RendererProps): void {
    this.component = component;
  }
  publicProps(): Record<string, unknown> {
    const props: Record<string, unknown> = {};
    for (const name of this.manifest.permissions.props) {
      const binding = this.component.node.bindings.find((b) => b.prop === name);
      if (binding) {
        const deps =
          'variable' in binding
            ? [`vars.${binding.variable}`]
            : extractDependencies(binding.expression);
        for (const dep of deps) {
          const key = dep.startsWith('vars.') ? dep.split('.')[1] : undefined;
          if (!key || key === '*' || this.component.runtime.store.classification(key) !== 'public')
            throw new RuntimeProblem('VERBIS_PLUGIN_PRIVATE_PROP');
        }
      }
      const value = this.component.props[name];
      if (value !== undefined) props[name] = value;
    }
    return props;
  }
  async handle(input: unknown): Promise<number> {
    const message = GuestMessageSchema.parse(input),
      now = this.now();
    if (message.seq !== this.last + 1) throw new RuntimeProblem('VERBIS_PLUGIN_REPLAY');
    this.last = message.seq;
    if (now - this.windowStart >= 1000) {
      this.windowStart = now;
      this.count = 0;
    }
    if (++this.count > 100) throw new RuntimeProblem('VERBIS_PLUGIN_RATE_LIMIT');
    if (!this.component.enabled) throw new RuntimeProblem('VERBIS_PLUGIN_DISABLED');
    if (message.op === 'resize') {
      this.resize(message.height);
      return message.seq;
    }
    if (message.op === 'emit') {
      if (!this.manifest.permissions.events.includes(message.event))
        throw new RuntimeProblem('VERBIS_PLUGIN_PERMISSION');
      await this.component.emit(message.event);
      return message.seq;
    }
    if (!this.manifest.permissions.write.includes(message.prop))
      throw new RuntimeProblem('VERBIS_PLUGIN_PERMISSION');
    const binding = this.component.node.bindings.find(
      (b) => b.prop === message.prop && 'variable' in b,
    );
    if (
      !binding ||
      !('variable' in binding) ||
      this.component.runtime.store.classification(binding.variable) !== 'public'
    )
      throw new RuntimeProblem('VERBIS_PLUGIN_PRIVATE_WRITE');
    this.schema.parse({ ...this.component.props, [message.prop]: message.value });
    this.component.write(message.prop, message.value);
    return message.seq;
  }
}
