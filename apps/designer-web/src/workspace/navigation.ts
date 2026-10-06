import type { SubjectType } from '@verbis/authz';

export const navigation = [
  { id: 'analytics', subject: 'Report', icon: 'Activity' },
  { id: 'campaigns', subject: 'Campaign', icon: 'Megaphone' },
  { id: 'scripts', subject: 'Script', icon: 'Workflow' },
  { id: 'screens', subject: 'Screen', icon: 'PanelsTopLeft' },
  { id: 'integrations', subject: 'Integration', icon: 'Plug' },
  { id: 'variables', subject: 'Script', icon: 'Braces' },
  { id: 'ai', subject: 'Script', icon: 'Braces' },
  { id: 'templates', subject: 'Script', icon: 'LayoutTemplate' },
  { id: 'releases', subject: 'Script', icon: 'Rocket' },
  { id: 'settings', subject: 'Tenant', icon: 'Settings2' },
] as const satisfies readonly { id: string; subject: SubjectType; icon: string }[];
export type Destination = (typeof navigation)[number]['id'];
