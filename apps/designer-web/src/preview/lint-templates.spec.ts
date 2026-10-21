import { describe, expect, it } from 'vitest';

import { completionBypasses, ScriptDocumentSchema } from '@verbis/script-schema';
import {
  collectionsScript,
  creditCardSalesScript,
  ecommerceOrderScript,
  insuranceRenewalScript,
  surveyScript,
  telecomTariffChangeScript,
} from '@verbis/script-schema/fixtures';

import { hygieneIssues, scriptHealth } from '../editor/health.js';
import { EditorStore } from '../editor/store.js';

import { previewLint } from './lint.js';

const templates = {
  creditCardSalesScript,
  telecomTariffChangeScript,
  collectionsScript,
  surveyScript,
  insuranceRenewalScript,
  ecommerceOrderScript,
};

describe('built-in templates', () => {
  it('have no completing outcome that bypasses a mandatory page', () => {
    for (const [name, input] of Object.entries(templates))
      expect({ name, bypasses: completionBypasses(ScriptDocumentSchema.parse(input)) }).toEqual({
        name,
        bypasses: [],
      });
  });

  // A new team's first look at a template is its health score: it must start clean.
  it.each(Object.entries(templates))('%s opens with a full health score', (_name, input) => {
    const document = ScriptDocumentSchema.parse(input);
    const store = new EditorStore(document);
    const issues = [...previewLint(document, store.issues()), ...hygieneIssues(document)];
    expect(issues.map((issue) => `${issue.code} ${issue.path}`)).toEqual([]);
    expect(scriptHealth(issues).score).toBe(100);
  });
});
