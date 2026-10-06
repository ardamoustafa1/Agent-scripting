import { describe, expect, it } from 'vitest';

import {
  AXP_DEFAULT_TOKEN_PATH,
  AxpEndpointsSchema,
  renderAxpPath,
  type AxpEndpoints,
} from './endpoints.js';

describe('AXP endpoint configuration (M-25, unverified against vendor)', () => {
  it('defaults to the legacy token path with wrap-up REST disabled', () => {
    const endpoints = AxpEndpointsSchema.parse({});
    expect(endpoints.tokenPath).toBe(AXP_DEFAULT_TOKEN_PATH);
    expect(endpoints.wrapUpMode).toBe('disabled');
  });
  it('accepts the new-style token path and a wrap-up path template', () => {
    expect(
      AxpEndpointsSchema.parse({
        tokenPath: '/api/auth/v1/{accountId}/protocol/openid-connect/token',
        wrapUpMode: 'rest',
        wrapUpPath: '/api/interactions/v1/accounts/{accountId}/interactions/{interactionId}/wrapup',
      }).wrapUpMode,
    ).toBe('rest');
  });
  it.each([
    'https://evil.example/token',
    '//evil.example/token',
    'token',
    '/a/../b',
    '/a/{unknown}/b',
    '/a?x=1',
    '/a b',
  ])('rejects the unsafe path %s', (path) => {
    expect(AxpEndpointsSchema.safeParse({ tokenPath: path }).success).toBe(false);
  });
  it('requires a wrap-up path when wrap-up REST is enabled', () => {
    expect(AxpEndpointsSchema.safeParse({ wrapUpMode: 'rest' }).success).toBe(false);
  });
  it('renders templates with encoded values', () => {
    expect(
      renderAxpPath('/x/{accountId}/y/{interactionId}', { accountId: 'A-1', interactionId: 'a/b' }),
    ).toBe('/x/A-1/y/a%2Fb');
  });
  it('type is exported', () => {
    const e: AxpEndpoints = AxpEndpointsSchema.parse({});
    expect(e.tokenPath.startsWith('/')).toBe(true);
  });
});
