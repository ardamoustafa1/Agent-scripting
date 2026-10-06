import { z } from 'zod';

import { ScriptDocumentSchema } from './schema/document.js';

export const SCRIPT_DOCUMENT_JSON_SCHEMA_ID =
  'https://schemas.verbis.io/script-document/1.0.0.json';

/**
 * JSON Schema (draft 2020-12) for the authoring/input shape of a script document, for
 * non-TypeScript consumers and editor tooling. Semantic rules are not expressible here;
 * run `validateScriptDocument` for those.
 */
export function scriptDocumentJsonSchema(): Record<string, unknown> {
  return {
    ...z.toJSONSchema(ScriptDocumentSchema, {
      target: 'draft-2020-12',
      io: 'input',
      unrepresentable: 'any',
    }),
    $id: SCRIPT_DOCUMENT_JSON_SCHEMA_ID,
  };
}
