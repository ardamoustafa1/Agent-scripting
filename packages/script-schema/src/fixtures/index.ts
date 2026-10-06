import { collectionsScript } from './collections.js';
import { creditCardSalesScript } from './credit-card-sales.js';
import { surveyScript } from './survey.js';
import { telecomTariffChangeScript } from './telecom-tariff-change.js';

import type { ScriptDocumentInput } from '../schema/document.js';

export { collectionsScript, creditCardSalesScript, surveyScript, telecomTariffChangeScript };
export { BROKEN_FIXTURES, type BrokenFixture } from './broken.js';
export { legacyDraftScript } from './legacy-draft.js';
export { minimalScript } from './minimal.js';

/** Valid sample scripts (no real customer data). */
export const VALID_FIXTURES: Readonly<Record<string, ScriptDocumentInput>> = {
  creditCardSales: creditCardSalesScript,
  telecomTariffChange: telecomTariffChangeScript,
  collections: collectionsScript,
  survey: surveyScript,
};
