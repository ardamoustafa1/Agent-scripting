import { DiscardPolicy, RetentionPolicy, StorageType, type StreamConfig } from '@nats-io/jetstream';

/** JetStream topology (ADR-0005). Subjects are `verbis.<context>.<aggregate>.<event>.v<N>`. */
export const DOMAIN_CONTEXTS = [
  'tenancy',
  'identity',
  'authz',
  'campaigns',
  'scripts',
  'screens',
  'assignments',
  'integrations',
  'connectors',
  'analytics',
  'admin',
] as const;

const TWO_MINUTES_NS = 2 * 60 * 1_000_000_000;
const DAY_NS = 24 * 60 * 60 * 1_000_000_000;

export type StreamDefinition = Pick<
  StreamConfig,
  'name' | 'subjects' | 'retention' | 'storage' | 'max_age' | 'duplicate_window' | 'num_replicas'
> &
  Partial<Pick<StreamConfig, 'deny_delete' | 'deny_purge' | 'max_bytes' | 'discard'>>;

export function streamDefinitions(replicas = 1): StreamDefinition[] {
  const base = {
    retention: RetentionPolicy.Limits,
    storage: StorageType.File,
    duplicate_window: TWO_MINUTES_NS,
    num_replicas: replicas,
  };
  return [
    {
      ...base,
      name: 'DOMAIN',
      subjects: DOMAIN_CONTEXTS.map((ctx) => `verbis.${ctx}.>`),
      max_age: 30 * DAY_NS,
    },
    { ...base, name: 'AUDIT', subjects: ['verbis.audit.>'], max_age: 90 * DAY_NS },
    {
      ...base,
      name: 'SECURITY',
      subjects: ['verbis.security.>'],
      max_age: 90 * DAY_NS,
      deny_delete: true,
      deny_purge: true,
      max_bytes: 1024 * 1024 * 1024,
      discard: DiscardPolicy.New,
    },
    { ...base, name: 'SESSION', subjects: ['verbis.runtime.>'], max_age: 30 * DAY_NS },
    { ...base, name: 'INTERACTION', subjects: ['verbis.interaction.>'], max_age: 30 * DAY_NS },
    { ...base, name: 'DLQ', subjects: ['verbis.dlq.>'], max_age: 30 * DAY_NS },
  ];
}

export function streamForSubject(subject: string): string | undefined {
  const context = subject.split('.')[1];
  if (context === 'audit') return 'AUDIT';
  if (context === 'security') return 'SECURITY';
  if (context === 'runtime') return 'SESSION';
  if (context === 'interaction') return 'INTERACTION';
  if (context === 'dlq') return 'DLQ';
  return (DOMAIN_CONTEXTS as readonly string[]).includes(context ?? '') ? 'DOMAIN' : undefined;
}
