import { expect, it, vi } from 'vitest';

import { AuthzController, MePermissionsController } from './authz.controller.js';

import type { AuthzService } from './authz.service.js';
import type { RolesService } from './roles.service.js';
import type { FastifyReply, FastifyRequest } from 'fastify';

it('uses required version headers and exposes the committed role version to clients', async () => {
  const role = { id: 'role', version: 2 };
  const roles = {
    vocabulary: vi.fn().mockReturnValue({ resources: ['script'] }),
    list: vi.fn().mockResolvedValue([role]),
    create: vi.fn().mockResolvedValue(role),
    update: vi.fn().mockResolvedValue(role),
    setScope: vi.fn().mockResolvedValue({ scope: {} }),
  };
  const authz = {
    me: vi.fn().mockReturnValue({ principal: {} }),
    mePermissions: vi.fn().mockReturnValue({ rules: [] }),
  };
  const controller = new AuthzController(
    authz as unknown as AuthzService,
    roles as unknown as RolesService,
  );
  const header = vi.fn(),
    reply = { header } as unknown as FastifyReply;
  expect(controller.me()).toEqual({ principal: {} });
  expect(controller.vocabulary()).toEqual({ resources: ['script'] });
  expect(await controller.list()).toEqual([role]);
  expect(await controller.create({ name: 'custom', matrix: {} }, reply)).toBe(role);
  expect(header).toHaveBeenCalledWith('etag', '"2"');
  await expect(
    controller.update('role', { matrix: {} }, { headers: {} } as FastifyRequest, reply),
  ).rejects.toMatchObject({ code: 'VERBIS_CONCURRENCY_PRECONDITION_REQUIRED' });
  expect(roles.update).not.toHaveBeenCalled();
  await controller.update(
    'role',
    { matrix: {} },
    { headers: { 'if-match': '"1"' } } as FastifyRequest,
    reply,
  );
  expect(roles.update).toHaveBeenCalledWith('role', 1, { matrix: {} });
  await controller.setScope('user', { role: 'agent', scope: {} });
  expect(roles.setScope).toHaveBeenCalledWith('user', { role: 'agent', scope: {} });
  expect(new MePermissionsController(authz as unknown as AuthzService).permissions()).toEqual({
    rules: [],
  });
});
