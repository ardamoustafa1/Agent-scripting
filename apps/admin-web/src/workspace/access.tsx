import { createContext, useContext } from 'react';

import { ActionSchema, SubjectTypeSchema, LEGACY_SUBJECTS, type AppAbility } from '@verbis/authz';

export const AccessContext = createContext<AppAbility | null>(null);
export function allowed(ability: AppAbility | null, action: string, subject: string) {
  const parsedAction = ActionSchema.safeParse(action),
    parsedSubject = SubjectTypeSchema.safeParse(LEGACY_SUBJECTS[subject] ?? subject);
  return (
    parsedAction.success &&
    parsedSubject.success &&
    (ability?.can(parsedAction.data, parsedSubject.data) ?? false)
  );
}
export function useCan() {
  const ability = useContext(AccessContext);
  return (action: string, subject: string) => allowed(ability, action, subject);
}
