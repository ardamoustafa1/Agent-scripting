import { readFile, writeFile } from 'node:fs/promises';

import openapiTS, { astToString } from 'openapi-typescript';
import ts from 'typescript';

const source = JSON.parse(
  await readFile(new URL('../../api/openapi.json', import.meta.url), 'utf8'),
);
// Recursive JSON needs a direct alias; an indexed property self-reference is rejected by TS6.
const ast = await openapiTS(source, {
  transform(schema, metadata) {
    if (
      schema.anyOf?.some(
        (branch) => branch.type === 'array' && branch.items?.$ref === metadata.path,
      )
    )
      return ts.factory.createTypeReferenceNode('DesignerJson');
  },
});
const jsonAlias =
  'type DesignerJson = string | number | boolean | null | DesignerJson[] | { [key: string]: DesignerJson };\n';
await writeFile(new URL('../src/api/generated.ts', import.meta.url), jsonAlias + astToString(ast));
