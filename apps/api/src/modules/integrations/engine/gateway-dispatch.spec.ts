import { expect, it, vi } from 'vitest';

import { IntegrationSaveSchema } from '@verbis/shared-types';

import { DefinitionSchema, PolicySchema } from './contracts.js';
import { gatewayDispatch } from './gateway-dispatch.js';

import type { PrivateEgressService } from '../private-egress.service.js';

const clientId = '00000000-0000-4000-8000-000000000001';
it('requires both tenant and source origin grants before creating a private HTTP job', async () => {
  const dispatch = vi.fn().mockResolvedValue({ status: 200, headers: {}, body: '{}' });
  const send = gatewayDispatch({ dispatch } as unknown as PrivateEgressService);
  const source = {
    id: 'test',
    version: 1,
    protocol: 'rest' as const,
    definition: DefinitionSchema.parse({
      baseUrl: 'https://crm.corp.test',
      endpoint: '/customer',
      privateGateway: { clientId, target: 'crm' },
    }),
    policy: PolicySchema.parse({ allowedOrigins: ['https://crm.corp.test'] }),
  };
  const wire = { url: new URL('https://crm.corp.test/customer'), method: 'GET', headers: {} };
  expect(() =>
    send('tenant', source, { input: {}, environment: 'test' }, wire, [], AbortSignal.timeout(5000)),
  ).toThrow('EGRESS_DENIED');
  expect(dispatch).not.toHaveBeenCalled();
  await send(
    'tenant',
    source,
    { input: {}, environment: 'test' },
    wire,
    ['https://crm.corp.test'],
    AbortSignal.timeout(5000),
  );
  expect(dispatch).toHaveBeenCalledWith(
    'tenant',
    clientId,
    'crm',
    expect.objectContaining({ kind: 'http' }),
    5000,
    1024 * 1024,
    expect.any(AbortSignal),
  );
});
it('refuses direct SQL, cache and API auth configurations for private sources', () => {
  const definition = {
    baseUrl: 'https://sql.invalid',
    endpoint: '/query',
    sql: { queryKey: 'lookup', parameters: ['id'] },
  };
  expect(
    IntegrationSaveSchema.safeParse({ key: 'sql', protocol: 'sql', definition, policy: {} })
      .success,
  ).toBe(false);
  const privateDefinition = { ...definition, privateGateway: { clientId, target: 'db' } };
  for (const bad of [
    { policy: { cacheTtlSeconds: 1 } },
    { definition: { ...privateDefinition, auth: { type: 'bearer', secretRef: clientId } } },
  ])
    expect(
      IntegrationSaveSchema.safeParse({
        key: 'sql',
        protocol: 'sql',
        definition: privateDefinition,
        policy: {},
        ...bad,
      }).success,
    ).toBe(false);
});
