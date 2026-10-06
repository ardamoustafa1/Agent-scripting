// Regenerates schema/script-document.schema.json from the zod schemas (run after `pnpm build`).
// A spec fails when the committed file drifts from the schemas.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { scriptDocumentJsonSchema } from '../dist/index.js';

const target = new URL('../schema/script-document.schema.json', import.meta.url);
writeFileSync(target, `${JSON.stringify(scriptDocumentJsonSchema(), null, 2)}\n`);
process.stdout.write(`Wrote ${fileURLToPath(target)}\n`);
