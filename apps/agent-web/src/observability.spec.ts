import { describe, expect, it } from 'vitest';

import { routeTemplate } from './observability.js';

describe('browser trace privacy', () => {
  it('replaces session identifiers and refuses unknown/external routes', () => {
    expect(routeTemplate('/api/v1/sessions/private/desktop/data-source')).toBe(
      '/api/v1/sessions/:id/desktop/data-source',
    );
    expect(routeTemplate('/api/v1/launch/redeem')).toBe('/api/v1/launch/redeem');
    expect(routeTemplate('/telemetry/v1/traces')).toBe('other');
    expect(routeTemplate('/api/auth/token?code=secret')).toBe('other');
  });
});
