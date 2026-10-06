import { createContext, useContext } from 'react';

import type { Session } from '../api/client.js';

export const WorkspaceContext = createContext<{
  session: Session;
  environment: 'dev' | 'test' | 'prod';
} | null>(null);
export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('VERBIS_WORKSPACE_CONTEXT');
  return value;
}
