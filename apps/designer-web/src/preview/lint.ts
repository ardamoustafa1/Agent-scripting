import { walkNodes, type ScriptDocument, type Action } from '@verbis/script-schema';

import type { EditorIssue } from '../editor/store.js';

export function previewLint(document: ScriptDocument, base: readonly EditorIssue[]): EditorIssue[] {
  const issues = [...base];
  let legal = false;
  walkNodes(document, ({ node }) => {
    legal ||= node.props['mustRead'] === true;
    return true;
  });
  const flatten = (actions: readonly Action[]): Action[] =>
    actions.flatMap((action) => [
      action,
      ...('actions' in action ? flatten(action.actions) : []),
      ...(action.type === 'conditional'
        ? [...flatten(action.then), ...flatten(action.else ?? [])]
        : []),
    ]);
  walkNodes(document, ({ node, pointer }) => {
    const warn = (code: string, messageKey: string) =>
      issues.push({ severity: 'warning', code, path: pointer, messageKey });
    if (
      (node.type.endsWith('Input') ||
        [
          'textArea',
          'select',
          'multiSelect',
          'radioGroup',
          'checkboxGroup',
          'toggle',
          'datePicker',
          'timePicker',
          'slider',
        ].includes(node.type)) &&
      !node.props['labelKey'] &&
      !node.a11y?.labelKey &&
      !node.bindings.some((b) => b.prop === 'labelKey')
    )
      warn('VERBIS_LINT_LABEL', 'designer.preview.lintLabel');
    if (
      ['webService', 'autoComplete', 'lookup'].includes(node.type) &&
      node.props['trigger'] === 'onChange' &&
      node.props['debounceMs'] === 0
    )
      warn('VERBIS_LINT_DEBOUNCE', 'designer.preview.lintDebounce');
    const actions = flatten(Object.values(node.events).flat());
    if (
      legal &&
      (node.type === 'outcomeSubmit' || actions.some((a) => a.type === 'submitOutcome')) &&
      !actions.some((a) => a.type === 'validatePage')
    )
      warn('VERBIS_LINT_LEGAL', 'designer.preview.lintLegal');
    if (node.props['mustRead'] === true && node.props['acknowledged'] === true)
      warn('VERBIS_LINT_LEGAL_PRECHECKED', 'designer.preview.lintPrechecked');
    return true;
  });
  return issues;
}
