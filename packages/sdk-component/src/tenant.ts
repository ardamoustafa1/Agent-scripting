import { z } from 'zod';

import { PluginManifestSchema } from './protocol.js';

export const EnablementCommandSchema = z.strictObject({
  type: z.string(),
  version: z.string(),
  enabled: z.boolean(),
});
export interface EnablementTransaction {
  findPublished(type: string, version: string): Promise<unknown>;
  save(tenantId: string, type: string, version: string, enabled: boolean): Promise<void>;
  audit(event: {
    tenantId: string;
    actorId: string;
    action: 'component.plugin.enabled' | 'component.plugin.disabled';
    type: string;
    version: string;
  }): Promise<void>;
}
export interface EnablementPorts {
  authorize(actorId: string, tenantId: string): Promise<void>;
  transaction<T>(tenantId: string, work: (tx: EnablementTransaction) => Promise<T>): Promise<T>;
}
/** Server-side service: tenant/actor come from authenticated context, never from command JSON. */
export class TenantComponentService {
  constructor(private ports: EnablementPorts) {}
  async setEnabled(context: { tenantId: string; actorId: string }, input: unknown): Promise<void> {
    const command = EnablementCommandSchema.parse(input);
    await this.ports.authorize(context.actorId, context.tenantId);
    await this.ports.transaction(context.tenantId, async (tx) => {
      const manifest = PluginManifestSchema.parse(
        await tx.findPublished(command.type, command.version),
      );
      if (manifest.type !== command.type || manifest.version !== command.version)
        throw new Error('VERBIS_PLUGIN_VERSION');
      await tx.save(context.tenantId, command.type, command.version, command.enabled);
      await tx.audit({
        ...context,
        action: command.enabled ? 'component.plugin.enabled' : 'component.plugin.disabled',
        type: command.type,
        version: command.version,
      });
    });
  }
}
