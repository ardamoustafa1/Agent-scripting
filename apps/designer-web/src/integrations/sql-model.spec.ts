import { expect, it } from 'vitest';

import { IntegrationSaveSchema } from '@verbis/shared-types';

import { defaults } from './importers.js';
import {
  emptySqlForm,
  sqlDefinitionPatch,
  sqlFormOf,
  validateSql,
  withoutSql,
  type SqlForm,
} from './sql-model.js';

const good: SqlForm = {
  clientId: '01990000-0000-7000-8000-000000000001',
  target: 'crm-readonly',
  queryKey: 'customer-by-id',
  parameters: ['customer.id', 'region'],
};
const draftOf = (form: SqlForm) => ({
  ...defaults(),
  key: 'sql-lookup',
  protocol: 'sql' as const,
  definition: { ...defaults().definition, ...sqlDefinitionPatch(form) },
});
it('builds a definition the shared server schema accepts, with no query text or credentials', () => {
  expect(validateSql(good)).toEqual({});
  const parsed = IntegrationSaveSchema.parse(draftOf(good));
  expect(parsed.definition.sql).toEqual({
    queryKey: 'customer-by-id',
    parameters: good.parameters,
  });
  expect(parsed.definition.auth).toEqual({ type: 'none' });
  expect(JSON.stringify(parsed.definition)).not.toMatch(/select |password|secretRef/i);
});
it('rejects injection-shaped, malformed and oversized input exactly like the server', () => {
  const bad = {
    clientId: 'not-a-uuid',
    target: 'Crm; DROP TABLE x',
    queryKey: "x'; --",
    parameters: ['a b', "1' OR '1'='1", '$(id)', '../etc', 'ok.path'],
  };
  const errors = validateSql(bad);
  expect(errors).toMatchObject({
    clientId: 'invalid',
    target: 'invalid',
    queryKey: 'invalid',
    'parameter-0': 'invalid',
    'parameter-1': 'invalid',
    'parameter-2': 'invalid',
    'parameter-3': 'invalid',
  });
  expect(errors['parameter-4']).toBeUndefined();
  expect(IntegrationSaveSchema.safeParse(draftOf(bad)).success).toBe(false);
  expect(validateSql(emptySqlForm())).toMatchObject({ clientId: 'required', queryKey: 'required' });
  expect(
    validateSql({ ...good, parameters: Array.from({ length: 101 }, () => 'p') }).parameters,
  ).toBe('tooMany');
});
it('round-trips and strips SQL fields when leaving the protocol', () => {
  const definition = IntegrationSaveSchema.parse(draftOf(good)).definition;
  expect(sqlFormOf(definition)).toEqual(good);
  const stripped = withoutSql(definition);
  expect(stripped.sql).toBeUndefined();
  expect(stripped.privateGateway).toBeUndefined();
  expect(stripped.baseUrl).toBe('');
});
