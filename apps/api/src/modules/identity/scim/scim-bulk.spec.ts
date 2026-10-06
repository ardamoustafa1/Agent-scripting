import { expect, it, vi } from 'vitest';

import { requestContext, systemContext } from '../../../common/context/request-context.js';

import { ScimBulkRequestSchema, ScimBulkService } from './scim-bulk.js';
import { ScimError } from './scim.errors.js';
import { PATCH_SCHEMA } from './scim.resources.js';

import type { ScimService } from './scim.service.js';
import type { IdentityTx } from '../core/identity-tx.js';

const id = '0199a000-0000-7000-8000-000000000001';
const schema = 'urn:ietf:params:scim:api:messages:2.0:BulkRequest';
function setup() {
  const resource = { id, meta: { location: `https://example.com/scim/Users/${id}` } };
  const scim = {
    baseUrl: () => 'https://example.com/scim',
    createUser: vi.fn().mockResolvedValue(resource),
    createGroup: vi.fn().mockResolvedValue(resource),
    replaceUser: vi.fn().mockResolvedValue(resource),
    replaceGroup: vi.fn().mockResolvedValue(resource),
    patchUser: vi.fn().mockResolvedValue(resource),
    patchGroup: vi.fn().mockResolvedValue(resource),
    deleteUser: vi.fn().mockResolvedValue(undefined),
    deleteGroup: vi.fn().mockResolvedValue(undefined),
  };
  const tx = {
    run: vi.fn((_tenant: string, _actor: unknown, fn: () => unknown) => fn()),
    record: vi.fn().mockResolvedValue(undefined),
  };
  const service = new ScimBulkService(scim as unknown as ScimService, tx as unknown as IdentityTx);
  const run = (Operations: unknown[], failOnErrors?: number) =>
    requestContext.run(
      {
        ...systemContext('c', 'test'),
        principal: { type: 'service', id: 'scim:token', tenantId: id, scopes: [] },
      },
      () =>
        service.execute(
          'tenant',
          ScimBulkRequestSchema.parse({ schemas: [schema], Operations, failOnErrors }),
        ),
    );
  return { scim, tx, run, service };
}
it.each(['Users', 'Groups'])(
  'supports all mutation methods for %s with independent transactions',
  async (kind) => {
    const f = setup();
    const data = kind === 'Users' ? { userName: 'user@example.com' } : { displayName: 'team' };
    const result = await f.run([
      { method: 'POST', bulkId: 'new', path: `/${kind}`, data },
      { method: 'PUT', path: `/${kind}/bulkId:new`, data },
      {
        method: 'PATCH',
        path: `/${kind}/${id}`,
        data: {
          schemas: [PATCH_SCHEMA],
          Operations: [
            {
              op: 'replace',
              path: kind === 'Users' ? 'displayName' : 'displayName',
              value: 'updated',
            },
          ],
        },
      },
      { method: 'DELETE', path: `/${kind}/${id}` },
    ]);
    expect(result.Operations.map((op) => op.status)).toEqual(['201', '200', '200', '204']);
    expect(f.tx.run).toHaveBeenCalledTimes(4);
    expect(result.Operations[3]?.location).toBe(`https://example.com/scim/${kind}/${id}`);
  },
);
it('resolves forward member references in direct and pathless patches without rewriting names', async () => {
  const f = setup();
  const result = await f.run([
    {
      method: 'PATCH',
      path: `/Groups/${id}`,
      data: {
        schemas: [PATCH_SCHEMA],
        Operations: [
          { op: 'add', path: 'members', value: [{ value: 'bulkId:new' }] },
          { op: 'add', value: { members: [{ value: 'bulkId:new' }] } },
        ],
      },
    },
    { method: 'POST', path: '/Users', bulkId: 'new', data: { userName: 'bulkId:new@example.com' } },
  ]);
  expect(result.Operations.map((op) => op.status)).toEqual(['200', '201']);
  expect(f.scim.patchGroup).toHaveBeenCalledWith(
    'tenant',
    id,
    expect.objectContaining({
      Operations: [
        { op: 'add', path: 'members', value: [{ value: id }] },
        { op: 'add', value: { members: [{ value: id }] } },
      ],
    }),
  );
  expect(f.scim.createUser).toHaveBeenCalledWith(
    'tenant',
    expect.objectContaining({ userName: 'bulkId:new@example.com' }),
  );
});
it('returns generic unexpected errors without exposing secrets and audits failure', async () => {
  const f = setup();
  f.scim.createUser.mockRejectedValue(new Error('secret DB credentials'));
  const result = await f.run([
    { method: 'POST', path: '/Users', bulkId: 'new', data: { userName: 'user@example.com' } },
    { method: 'DELETE', path: '/Users/bulkId:new' },
  ]);
  expect(result.Operations.map((op) => op.status)).toEqual(['500', '400']);
  expect(JSON.stringify(result)).not.toContain('secret');
  expect(f.tx.record).toHaveBeenCalledTimes(2);
});
it('stops at failOnErrors including unresolved cycles and validates data before mutation', async () => {
  const f = setup();
  const result = await f.run(
    [
      { method: 'POST', path: '/Users', bulkId: 'bad', data: {} },
      { method: 'DELETE', path: `/Users/${id}` },
    ],
    1,
  );
  expect(result.Operations.map((op) => op.status)).toEqual(['400']);
  expect(f.scim.createUser).not.toHaveBeenCalled();
  expect(f.scim.deleteUser).not.toHaveBeenCalled();
  const cycle = await f.run(
    [
      {
        method: 'POST',
        bulkId: 'a',
        path: '/Groups',
        data: { displayName: 'A', members: [{ value: 'bulkId:b' }] },
      },
      {
        method: 'POST',
        bulkId: 'b',
        path: '/Groups',
        data: { displayName: 'B', members: [{ value: 'bulkId:a' }] },
      },
    ],
    1,
  );
  expect(cycle.Operations.map((op) => op.status)).toEqual(['409']);
});
it.each([
  '/../Users',
  'https://evil.example/Users',
  `/users/${id}`,
  '/Users',
  '/Groups/not-a-uuid',
])('rejects invalid DELETE path %s', async (path) => {
  const f = setup();
  const result = await f.run([{ method: 'DELETE', path }]);
  expect(result.Operations[0]?.status).toBe('400');
  expect(f.tx.run).not.toHaveBeenCalled();
});
it('requires a SCIM credential and rejects oversized and duplicate creator requests atomically', async () => {
  const f = setup();
  const input = ScimBulkRequestSchema.parse({
    schemas: [schema],
    Operations: [{ method: 'DELETE', path: `/Users/${id}` }],
  });
  await expect(
    requestContext.run(systemContext('c', 'test'), () => f.service.execute('tenant', input)),
  ).rejects.toBeInstanceOf(ScimError);
  const operation = {
    method: 'POST',
    bulkId: 'a',
    path: '/Users',
    data: { userName: 'user@example.com' },
  };
  await expect(f.run([operation, operation])).rejects.toMatchObject({ status: 400 });
  await expect(f.run([{ ...operation, bulkId: undefined }])).rejects.toMatchObject({ status: 400 });
  await expect(
    f.run(Array.from({ length: 101 }, () => ({ method: 'DELETE', path: `/Users/${id}` }))),
  ).rejects.toMatchObject({ status: 413 });
  await expect(
    f.run([{ ...operation, data: { padding: 'x'.repeat(1_048_576) } }]),
  ).rejects.toMatchObject({ status: 413 });
  expect(f.tx.run).not.toHaveBeenCalled();
});
