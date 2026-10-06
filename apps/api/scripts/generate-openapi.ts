/** Regenerates apps/api/openapi.json (committed; a spec fails when it drifts from the code). */
import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { openApiDocument } from '../src/openapi/docs.js';

const target = path.resolve(import.meta.dirname, '../openapi.json');
writeFileSync(target, `${JSON.stringify(openApiDocument('1.0.0'), null, 2)}\n`);
process.stdout.write(`Wrote ${target}\n`);
