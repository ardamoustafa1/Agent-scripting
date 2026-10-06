import { expect, it } from 'vitest';

import { minimalScript } from '../fixtures/minimal.js';
import { ScriptDocumentSchema } from '../schema/document.js';

import { validateSemantics } from './semantic.js';

it.each([true, false])(
  'rejects preselected consent defaults and accepts a false default (%s)',
  (preselected) => {
    const doc = minimalScript();
    doc.variables = [
      {
        key: 'consent',
        scope: 'session',
        type: 'boolean',
        default: preselected,
        classification: 'internal',
        pii: false,
        persist: true,
      },
    ];
    doc.pages[0]!.layout.children = [
      {
        id: 'consent-field',
        type: 'explicitConsent',
        props: {},
        bindings: [{ prop: 'value', variable: 'consent' }],
        events: {},
      },
    ];
    const issues = validateSemantics(ScriptDocumentSchema.parse(doc));
    expect(issues.some((issue) => issue.code === 'CONSENT_PRESELECTED')).toBe(preselected);
  },
);
