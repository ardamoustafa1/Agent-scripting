import XMLBuilder from 'fast-xml-builder';
import { XMLParser } from 'fast-xml-parser';
import { SyntaxValidator } from 'fast-xml-validator';
import { Kind, parse, visit, getIntrospectionQuery } from 'graphql';

import { IntegrationError } from './transport.js';

import type { Definition } from './contracts.js';

export const xmlEscape = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
export function xmlToJson(xml: string): unknown {
  if (Buffer.byteLength(xml) > 5 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new IntegrationError('XML_INVALID');
  try {
    SyntaxValidator.validate(xml);
  } catch {
    throw new IntegrationError('XML_INVALID');
  }
  return new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    processEntities: false,
  }).parse(xml) as unknown;
}
export function soapEnvelope(
  definition: NonNullable<Definition['soap']>,
  value: unknown,
  security = '',
): string {
  const checkNames = (item: unknown): void => {
    if (Array.isArray(item)) {
      item.forEach(checkNames);
      return;
    }
    if (!item || typeof item !== 'object') return;
    for (const [key, nested] of Object.entries(item)) {
      if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key)) throw new IntegrationError('XML_NAME_INVALID');
      checkNames(nested);
    }
  };
  checkNames(value);
  const body = new XMLBuilder({ ignoreAttributes: false }).build({
    [definition.operation]: {
      '@_xmlns': definition.namespace,
      ...(value && typeof value === 'object' && !Array.isArray(value) ? value : { value }),
    },
  });
  return `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Header>${security}</soap:Header><soap:Body>${body}</soap:Body></soap:Envelope>`;
}
export function importWsdl(xml: string): {
  operations: { name: string; action: string }[];
  definition: unknown;
  namespace?: string;
} {
  const definition = xmlToJson(xml);
  const operations = new Map<string, string>();
  let namespace: string | undefined;
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const obj = value as Record<string, unknown>;
    if (typeof obj['@_targetNamespace'] === 'string' && obj['@_targetNamespace'].length <= 8192)
      namespace ??= obj['@_targetNamespace'];
    if (
      typeof obj['@_name'] === 'string' &&
      obj['operation'] &&
      typeof obj['operation'] === 'object'
    ) {
      const operation = obj['operation'] as Record<string, unknown>;
      if (typeof operation['@_soapAction'] === 'string')
        operations.set(obj['@_name'], operation['@_soapAction']);
    }
    Object.values(obj).forEach(walk);
  };
  walk(definition);
  return {
    operations: [...operations].map(([name, action]) => ({ name, action })),
    definition,
    ...(namespace ? { namespace } : {}),
  };
}
export function checkGraphql(config: NonNullable<Definition['graphql']>): void {
  const document = parse(config.query, { maxTokens: 5000 });
  // Deny fragments to avoid recursive amplification and count nested selections.
  let fields = 0;
  let depth = 0;
  visit(document, {
    FragmentSpread: () => {
      throw new IntegrationError('GRAPHQL_FRAGMENT_DENIED');
    },
    Field: {
      enter: () => {
        if (++fields > config.maxComplexity || ++depth > config.maxDepth)
          throw new IntegrationError('GRAPHQL_BUDGET');
      },
      leave: () => {
        depth--;
      },
    },
  });
  const operations = document.definitions.filter((node) => node.kind === Kind.OPERATION_DEFINITION);
  if (
    operations.length !== 1 ||
    operations[0]?.kind !== Kind.OPERATION_DEFINITION ||
    operations[0].operation !== 'query'
  )
    throw new IntegrationError('GRAPHQL_QUERY_ONLY');
}
export const introspectionQuery = () => getIntrospectionQuery();
