import { createContext, useContext, useEffect, useReducer, type ReactNode } from 'react';

import { createAbility, type AppAbility, type AppSubject } from './ability.js';

import type { Action } from './vocabulary.js';

/**
 * UI gating only: hiding a button is a convenience, never a control. The API enforces every
 * permission again (SECURITY §5.5).
 */
const AbilityContext = createContext<AppAbility>(createAbility([]));

export function AbilityProvider({
  ability,
  children,
}: {
  readonly ability: AppAbility;
  readonly children: ReactNode;
}): ReactNode {
  return <AbilityContext.Provider value={ability}>{children}</AbilityContext.Provider>;
}

/** The current ability; re-renders when its rules are updated (`ability.update`). */
export function useAbility(): AppAbility {
  const ability = useContext(AbilityContext);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => ability.on('updated', rerender), [ability]);
  return ability;
}

export function useCan(action: Action, subject: AppSubject, field?: string): boolean {
  return useAbility().can(action, subject, field);
}

export interface CanProps {
  readonly I: Action;
  readonly a: AppSubject;
  readonly field?: string;
  /** Render when NOT allowed (e.g. a read-only hint). */
  readonly not?: boolean;
  readonly children: ReactNode;
}

/** `<Can I="publish" a="Script"><Button …/></Can>` */
export function Can({ I, a, field, not = false, children }: CanProps): ReactNode {
  const allowed = useCan(I, a, field);
  return allowed !== not ? children : null;
}
