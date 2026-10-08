import { describe, expect, it } from 'vitest';

import { completionBypasses, ScriptDocumentSchema } from '@verbis/script-schema';
import {
  collectionsScript,
  creditCardSalesScript,
  surveyScript,
  telecomTariffChangeScript,
} from '@verbis/script-schema/fixtures';

describe('built-in templates', () => {
  it('have no completing outcome that bypasses a mandatory page', () => {
    const templates = {
      creditCardSalesScript,
      telecomTariffChangeScript,
      collectionsScript,
      surveyScript,
    };
    for (const [name, input] of Object.entries(templates))
      expect({ name, bypasses: completionBypasses(ScriptDocumentSchema.parse(input)) }).toEqual({
        name,
        bypasses: [],
      });
  });
});
