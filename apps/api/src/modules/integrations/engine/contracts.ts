import type {
  IntegrationDefinition as Definition,
  IntegrationPolicy as Policy,
} from '@verbis/shared-types';

export {
  IntegrationDefinitionSchema as DefinitionSchema,
  IntegrationPolicySchema as PolicySchema,
  IntegrationAuthSchema as AuthSchema,
  IntegrationSaveSchema as SaveDataSourceSchema,
  IntegrationCallSchema as CallSchema,
  IntegrationSecretSetSchema as SecretSetSchema,
  IntegrationConsoleSchema as ConsoleResultSchema,
} from '@verbis/shared-types';
export type {
  IntegrationDefinition as Definition,
  IntegrationPolicy as Policy,
  IntegrationAuth as Auth,
  IntegrationCall as Call,
} from '@verbis/shared-types';
export interface WireRequest {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body?: string;
  tls?: { cert?: string; key?: string; ca?: string | undefined };
}
export interface WireResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}
export interface DataSource {
  id: string;
  version: number;
  protocol: 'rest' | 'soap' | 'graphql' | 'sql';
  definition: Definition;
  policy: Policy;
}
/** SQL read-only and gRPC adapters can implement this contract; no arbitrary SQL is exposed. */
export interface ExtensionDriver {
  execute(input: unknown, signal: AbortSignal): Promise<unknown>;
}
