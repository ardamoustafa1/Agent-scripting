import { z } from 'zod';

/**
 * Authorization vocabulary (SECURITY §5.5). Resources are the rows of the custom-role permission
 * matrix; `PLATFORM_SUBJECTS` are administrative subjects outside the matrix (TenantAdmin/SuperAdmin).
 */
export const RESOURCES = [
  'campaign',
  'script',
  'screen',
  'integration',
  'secret',
  'connector',
  'user',
  'role',
  'idp',
  'audit',
  'report',
  'session',
] as const;
export type Resource = (typeof RESOURCES)[number];

export const ACTIONS = [
  'read',
  'create',
  'update',
  'delete',
  'publish',
  'approve',
  'execute',
  'reveal',
  'export',
  'manage',
] as const;
export type Action = (typeof ACTIONS)[number];

/** CASL subject name of each matrix resource. */
export const RESOURCE_SUBJECT = {
  campaign: 'Campaign',
  script: 'Script',
  screen: 'Screen',
  integration: 'Integration',
  secret: 'Secret',
  connector: 'Connector',
  user: 'User',
  role: 'Role',
  idp: 'Idp',
  audit: 'Audit',
  report: 'Report',
  session: 'Session',
} as const satisfies Record<Resource, string>;
export type ResourceSubject = (typeof RESOURCE_SUBJECT)[Resource];

export const PLATFORM_SUBJECTS = ['Tenant', 'BreakGlassAccount', 'Outbox', 'ApiDocs'] as const;
export type PlatformSubject = (typeof PLATFORM_SUBJECTS)[number];

export type SubjectType = ResourceSubject | PlatformSubject | 'all';
export const SUBJECT_TYPES: readonly SubjectType[] = [
  ...Object.values(RESOURCE_SUBJECT),
  ...PLATFORM_SUBJECTS,
  'all',
];

/** Actions that make sense per resource; the matrix editor and validation use this. */
export const RESOURCE_ACTIONS: Readonly<Record<Resource, readonly Action[]>> = {
  campaign: ['read', 'create', 'update', 'delete', 'manage'],
  script: ['read', 'create', 'update', 'delete', 'publish', 'approve', 'manage'],
  screen: ['read', 'create', 'update', 'delete', 'manage'],
  integration: ['read', 'create', 'update', 'delete', 'execute', 'manage'],
  secret: ['read', 'create', 'update', 'delete', 'manage'],
  connector: ['read', 'create', 'update', 'delete', 'manage'],
  user: ['read', 'create', 'update', 'delete', 'reveal', 'manage'],
  role: ['read', 'create', 'update', 'delete', 'manage'],
  idp: ['read', 'create', 'update', 'delete', 'manage'],
  audit: ['read', 'export'],
  report: ['read', 'export', 'manage'],
  session: ['read', 'create', 'update', 'reveal', 'manage'],
};

/**
 * PII-classified fields per subject (`@pii` in the schema). Reading a record never implies seeing
 * these: they need `reveal` on the field.
 */
export const PII_FIELDS: Readonly<Partial<Record<SubjectType, readonly string[]>>> = {
  User: ['email', 'displayName'],
  Session: ['customer', 'variables'],
  Audit: ['ip', 'userAgent', 'displayName'],
};

export const ActionSchema = z.enum(ACTIONS);
export const ResourceSchema = z.enum(RESOURCES);
export const SubjectTypeSchema = z.enum(SUBJECT_TYPES as [SubjectType, ...SubjectType[]]);
