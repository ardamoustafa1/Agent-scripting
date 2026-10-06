import { describe, expect, it, vi } from 'vitest';

import { AuthController, AuthSessionStatusSchema } from './auth.controller.js';

import type { FastifyReply, FastifyRequest } from 'fastify';

const IDS = {
  user: '018f0000-0000-7000-8000-000000000001',
  tenant: '018f0000-0000-7000-8000-000000000002',
  session: '018f0000-0000-7000-8000-000000000003',
};

const status = (request: FastifyRequest, response: FastifyReply) =>
  new AuthController({} as never, {} as never).sessionStatus(request, response);
const header = vi.fn();
const reply = () => ({ header }) as unknown as FastifyReply;

describe('GET /auth/session/status (U-01)', () => {
  it('answers 200 {authenticated:false} instead of a 401 when there is no session', () => {
    const reply_ = reply();
    const body = status({} as FastifyRequest, reply_);
    expect(body).toEqual({ authenticated: false });
    expect(AuthSessionStatusSchema.safeParse(body).success).toBe(true);
    expect(header).toHaveBeenCalledWith('cache-control', 'no-store');
  });

  it('returns the full session plus the CSRF token when signed in', () => {
    const request = {
      verbisSession: {
        hash: 'h',
        record: {
          id: IDS.session,
          userId: IDS.user,
          tenantId: IDS.tenant,
          kind: 'sso',
          protocol: 'oidc',
          idpId: null,
          app: 'admin',
          createdAt: 1_000,
          lastSeenAt: 2_000,
          absoluteExpiresAt: 9_000,
          idleTimeoutSeconds: 60,
          ip: '203.0.113.9',
          userAgent: 'test',
          csrfToken: 'csrf-1',
        },
      },
    } as unknown as FastifyRequest;
    const body = status(request, reply());
    expect(body).toMatchObject({
      authenticated: true,
      user: { id: IDS.user, tenantId: IDS.tenant, authMethod: 'sso' },
      csrfToken: 'csrf-1',
    });
    expect(AuthSessionStatusSchema.safeParse(body).success).toBe(true);
  });
});
