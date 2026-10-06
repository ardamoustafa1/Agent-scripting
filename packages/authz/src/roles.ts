import type { RuleDefinition } from './rules.js';

/** Stable keys of the built-in roles (stored as `roles.name` with `is_system = true`). */
export const SYSTEM_ROLE_KEYS = [
  'super_admin',
  'tenant_admin',
  'security_auditor',
  'script_designer',
  'script_approver',
  'integration_engineer',
  'campaign_manager',
  'supervisor',
  'agent',
  'report_viewer',
  'api_client',
] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

export interface SystemRoleDefinition {
  readonly key: SystemRoleKey;
  /** i18n key of the display name (`authz.roles.<key>`). */
  readonly labelKey: string;
  /** Platform roles are assignable only in the platform tenant. */
  readonly platform: boolean;
  /** Which scope attributes an assignment of this role uses (ABAC). */
  readonly scopedBy: readonly ('campaignIds' | 'teamIds' | 'siteIds')[];
  readonly rules: readonly RuleDefinition[];
}

const CAMPAIGNS = '${scope.campaignIds}';
const TEAMS = '${scope.teamIds}';
const ME = '${user.id}';

function role(
  key: SystemRoleKey,
  rules: RuleDefinition[],
  options: { platform?: boolean; scopedBy?: SystemRoleDefinition['scopedBy'] } = {},
): SystemRoleDefinition {
  return {
    key,
    labelKey: `authz.roles.${key}`,
    platform: options.platform ?? false,
    scopedBy: options.scopedBy ?? [],
    rules,
  };
}

export const SYSTEM_ROLES: Readonly<Record<SystemRoleKey, SystemRoleDefinition>> = {
  super_admin: role('super_admin', [{ action: 'manage', subject: 'all' }], { platform: true }),

  tenant_admin: role('tenant_admin', [{ action: 'manage', subject: 'all' }]),

  security_auditor: role('security_auditor', [{ action: ['read', 'export'], subject: 'Audit' }]),

  script_designer: role(
    'script_designer',
    [
      { action: 'read', subject: 'Campaign', conditions: { id: { $in: CAMPAIGNS } } },
      {
        action: ['read', 'create', 'update', 'delete'],
        subject: ['Script', 'Screen'],
        conditions: { campaignIds: { $in: CAMPAIGNS } },
      },
      { action: 'read', subject: 'Integration' },
    ],
    { scopedBy: ['campaignIds'] },
  ),

  script_approver: role(
    'script_approver',
    [
      { action: 'read', subject: 'Campaign', conditions: { id: { $in: CAMPAIGNS } } },
      {
        action: ['read', 'approve', 'publish'],
        subject: 'Script',
        conditions: { campaignIds: { $in: CAMPAIGNS } },
      },
      { action: 'read', subject: 'Screen', conditions: { campaignIds: { $in: CAMPAIGNS } } },
    ],
    { scopedBy: ['campaignIds'] },
  ),

  integration_engineer: role('integration_engineer', [
    { action: 'manage', subject: ['Integration', 'Secret', 'Connector'] },
    { action: 'read', subject: 'Campaign' },
  ]),

  campaign_manager: role(
    'campaign_manager',
    [
      { action: 'create', subject: 'Campaign' },
      {
        action: ['read', 'update', 'delete'],
        subject: 'Campaign',
        conditions: { id: { $in: CAMPAIGNS } },
      },
      { action: 'read', subject: 'Script', conditions: { campaignIds: { $in: CAMPAIGNS } } },
      { action: 'read', subject: 'Report', conditions: { campaignId: { $in: CAMPAIGNS } } },
      { action: 'read', subject: 'User' },
    ],
    { scopedBy: ['campaignIds'] },
  ),

  supervisor: role(
    'supervisor',
    [
      { action: 'read', subject: ['Campaign', 'Script'] },
      { action: 'read', subject: 'Session', conditions: { teamId: { $in: TEAMS } } },
      {
        action: 'reveal',
        subject: 'Session',
        fields: ['customer'],
        conditions: { teamId: { $in: TEAMS } },
      },
      { action: 'read', subject: 'User', conditions: { teamIds: { $in: TEAMS } } },
      { action: 'read', subject: 'Report', conditions: { teamId: { $in: TEAMS } } },
    ],
    { scopedBy: ['teamIds'] },
  ),

  agent: role(
    'agent',
    [
      {
        action: 'read',
        subject: ['Script', 'Screen'],
        conditions: { campaignIds: { $in: CAMPAIGNS } },
      },
      { action: 'create', subject: 'Session' },
      { action: ['read', 'update'], subject: 'Session', conditions: { agentId: ME } },
      { action: 'reveal', subject: 'Session', fields: ['customer'], conditions: { agentId: ME } },
    ],
    { scopedBy: ['campaignIds'] },
  ),

  report_viewer: role(
    'report_viewer',
    [
      {
        action: ['read', 'export'],
        subject: 'Report',
        conditions: { campaignId: { $in: CAMPAIGNS } },
      },
    ],
    { scopedBy: ['campaignIds'] },
  ),

  api_client: role('api_client', [
    { action: 'read', subject: ['Campaign', 'Script', 'Screen', 'Report'] },
    { action: ['create', 'update', 'read'], subject: 'Session' },
  ]),
};

export function isSystemRoleKey(value: string): value is SystemRoleKey {
  return (SYSTEM_ROLE_KEYS as readonly string[]).includes(value);
}
