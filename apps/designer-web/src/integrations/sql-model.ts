import {
  IntegrationDefinitionSchema,
  type IntegrationSaveSchema,
  type IntegrationDefinition,
} from '@verbis/shared-types';

import type { z } from 'zod';

type SaveDefinition = z.infer<typeof IntegrationSaveSchema>['definition'];

/**
 * Pure model for the named read-only SQL form. Query text is never authored in the browser
 * (ADR-0042): the form only selects an operator-provisioned query key and the ordered input
 * paths bound as positional parameters. Validation reuses the server schema, so both sides agree.
 */
export const SQL_PLACEHOLDER_BASE_URL = 'https://sql.invalid';
export const SQL_PLACEHOLDER_ENDPOINT = '/query';
export const MAX_SQL_PARAMETERS = 100;

const gatewayShape = IntegrationDefinitionSchema.shape.privateGateway.unwrap().shape;
const sqlShape = IntegrationDefinitionSchema.shape.sql.unwrap().shape;

export interface SqlForm {
  clientId: string;
  target: string;
  queryKey: string;
  parameters: string[];
}
export type SqlErrorKey = 'clientId' | 'target' | 'queryKey' | 'parameters' | `parameter-${number}`;
export type SqlErrors = Partial<Record<SqlErrorKey, 'required' | 'invalid' | 'tooMany'>>;

export function emptySqlForm(): SqlForm {
  return { clientId: '', target: '', queryKey: '', parameters: [] };
}
export function sqlFormOf(definition: SaveDefinition | IntegrationDefinition): SqlForm {
  return {
    clientId: definition.privateGateway?.clientId ?? '',
    target: definition.privateGateway?.target ?? '',
    queryKey: definition.sql?.queryKey ?? '',
    parameters: [...(definition.sql?.parameters ?? [])],
  };
}
/** Definition fields for a SQL source; API auth stays `none` (credentials live in the worker). */
export function sqlDefinitionPatch(form: SqlForm): Partial<SaveDefinition> {
  return {
    baseUrl: SQL_PLACEHOLDER_BASE_URL,
    endpoint: SQL_PLACEHOLDER_ENDPOINT,
    method: 'POST',
    auth: { type: 'none' },
    privateGateway: { clientId: form.clientId, target: form.target },
    sql: { queryKey: form.queryKey, parameters: form.parameters },
  };
}
export function validateSql(form: SqlForm): SqlErrors {
  const errors: SqlErrors = {};
  const check = (key: SqlErrorKey, ok: boolean, value: string) => {
    if (!ok) errors[key] = value === '' ? 'required' : 'invalid';
  };
  check('clientId', gatewayShape.clientId.safeParse(form.clientId).success, form.clientId);
  check('target', gatewayShape.target.safeParse(form.target).success, form.target);
  check('queryKey', sqlShape.queryKey.safeParse(form.queryKey).success, form.queryKey);
  if (form.parameters.length > MAX_SQL_PARAMETERS) errors.parameters = 'tooMany';
  form.parameters.forEach((path, index) => {
    check(`parameter-${index}`, sqlShape.parameters.element.safeParse(path).success, path);
  });
  return errors;
}
/** Removes SQL-only fields (and the placeholder endpoint) when switching away from SQL. */
export function withoutSql(definition: SaveDefinition): SaveDefinition {
  const { sql: _sql, privateGateway: _gateway, ...rest } = definition;
  const placeholder = rest.baseUrl === SQL_PLACEHOLDER_BASE_URL;
  return { ...rest, ...(placeholder ? { baseUrl: '', endpoint: '/' } : {}) };
}
