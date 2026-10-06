import { expect, it, vi } from 'vitest';

import { SessionCookie } from './session-cookie.js';

import type { ApiEnv } from '../../../env.js';
import type { FastifyReply } from 'fastify';

it('uses host-only Secure HttpOnly session cookies with a fixed root path', () => {
  const cookie = new SessionCookie({
    SESSION_COOKIE_SECURE: true,
    SESSION_COOKIE_SAMESITE: 'lax',
    SESSION_COOKIE_NAME: 'verbis',
    SESSION_ABSOLUTE_TTL_SECONDS: 3600,
  } as unknown as ApiEnv);
  const setCookie = vi.fn(),
    reply = { setCookie } as unknown as FastifyReply;
  cookie.set(reply, 'opaque-session', 3600);
  expect(setCookie.mock.calls[0]?.[0]).toMatch(/^__Host-/);
  expect(setCookie.mock.calls[0]?.[2]).toMatchObject({
    secure: true,
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
  });
  expect(setCookie.mock.calls[0]?.[2]).not.toHaveProperty('domain');
});
