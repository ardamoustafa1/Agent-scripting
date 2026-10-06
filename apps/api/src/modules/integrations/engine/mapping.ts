import { Ajv } from 'ajv';
import jsonata from 'jsonata';

import { IntegrationError } from './transport.js';

const ajv = new Ajv({ allErrors: false, strict: true, validateFormats: false });
ajv.addKeyword({ keyword: 'classification', valid: true });
ajv.addKeyword({ keyword: 'x-classification', valid: true });
const validators = new Map<string, ReturnType<typeof ajv.compile>>();
export function validateSchema(schema: Record<string, unknown>, value: unknown): void {
  const key = JSON.stringify(schema);
  let validate = validators.get(key);
  if (!validate) {
    validate = ajv.compile(schema);
    ajv.removeSchema(schema);
    if (validators.size >= 500) validators.clear();
    validators.set(key, validate);
  }
  if (!validate(value)) throw new IntegrationError('SCHEMA_INVALID');
}
export async function mapValue(expression: string | undefined, value: unknown): Promise<unknown> {
  if (!expression) return value;
  const compiled = jsonata(expression, { timeout: 100, stack: 64, sequence: 10000 });
  let depth = 0;
  let steps = 0;
  const deadline = Date.now() + 100;
  compiled.assign('__evaluate_entry', () => {
    if (++depth > 64 || ++steps > 10000 || Date.now() > deadline)
      throw new IntegrationError('MAPPING_BUDGET');
  });
  compiled.assign('__evaluate_exit', () => {
    depth--;
  });
  const result: unknown = await compiled.evaluate(value);
  if (Buffer.byteLength(result === undefined ? '' : JSON.stringify(result)) > 1024 * 1024)
    throw new IntegrationError('MAPPING_BUDGET');
  return result;
}
const sensitive =
  /password|authorization|cookie|token|secret|api[-_]?key|email|phone|address|national.?id|pan|cvv/i;
/** Console traces keep structure but suppress all scalar bodies unless paths are public. */
export function redact(
  value: unknown,
  paths: readonly string[] = [],
  secrets: readonly string[] = [],
  path = '',
  conservative = false,
): unknown {
  if (paths.includes(path)) return '[REDACTED]';
  if (Array.isArray(value))
    return value.map((item, i) => redact(item, paths, secrets, `${path}.${i}`, conservative));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sensitive.test(key)
          ? '[REDACTED]'
          : redact(item, paths, secrets, path ? `${path}.${key}` : key, conservative),
      ]),
    );
  if (conservative && value !== null && value !== undefined) return '[REDACTED]';
  if (typeof value === 'string')
    return secrets
      .filter(Boolean)
      .reduce((result, secret) => result.split(secret).join('[REDACTED]'), value)
      .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[REDACTED]');
  return value;
}
export function containsSensitiveSchema(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(
    ([key, item]) =>
      ((key === 'classification' || key === 'x-classification') &&
        ['pii', 'pci', 'secret', 'sensitive'].includes(String(item))) ||
      sensitive.test(key) ||
      containsSensitiveSchema(item),
  );
}

/** Template substitution is data traversal only; keys cannot walk object prototypes. */
export function template(value: unknown, input: unknown): unknown {
  const resolve = (path: string): unknown =>
    path.split('.').reduce<unknown>((current, key) => {
      if (['__proto__', 'prototype', 'constructor'].includes(key))
        throw new IntegrationError('TEMPLATE_INVALID');
      return current && typeof current === 'object' && Object.hasOwn(current, key)
        ? (current as Record<string, unknown>)[key]
        : undefined;
    }, input);
  if (typeof value === 'string') {
    const exact = /^\{\{([A-Za-z0-9_.]+)\}\}$/.exec(value);
    if (exact?.[1]) return resolve(exact[1]) ?? null;
    return value.replace(/\{\{([A-Za-z0-9_.]+)\}\}/g, (_match, path: string) =>
      scalarText(resolve(path)),
    );
  }
  if (Array.isArray(value)) return value.map((item) => template(item, input));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, template(item, input)]),
    );
  return value;
}
export function scrubSecrets(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === 'string')
    return secrets
      .filter(Boolean)
      .reduce((text, secret) => text.split(secret).join('[REDACTED]'), value);
  if (Array.isArray(value)) return value.map((item) => scrubSecrets(item, secrets));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sensitive.test(key) && /token|secret|password|authorization|api[-_]?key|cookie/i.test(key)
          ? '[REDACTED]'
          : scrubSecrets(item, secrets),
      ]),
    );
  return value;
}

export function scalarText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  throw new IntegrationError('TEMPLATE_SCALAR_REQUIRED');
}
