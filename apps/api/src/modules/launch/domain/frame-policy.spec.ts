import { describe, expect, it } from 'vitest';

import { FrameAncestorSchema, frameHeaders } from './frame-policy.js';

describe('frame policy', () => {
  it('denies framing when nothing is allow-listed', () => {
    for (const settings of [
      undefined,
      null,
      {},
      { embedding: {} },
      { embedding: { frameAncestors: [] } },
    ])
      expect(frameHeaders(settings)).toEqual({
        'content-security-policy': "frame-ancestors 'none'",
        'x-frame-options': 'DENY',
      });
  });

  it('emits only the tenant allow-list (sorted, de-duplicated) without X-Frame-Options', () => {
    expect(
      frameHeaders({
        embedding: {
          frameAncestors: [
            'https://apps.mypurecloud.de',
            'https://*.crm.example.com',
            'https://apps.mypurecloud.de',
          ],
        },
      }),
    ).toEqual({
      'content-security-policy':
        'frame-ancestors https://*.crm.example.com https://apps.mypurecloud.de',
    });
  });

  it('falls back to DENY on invalid settings instead of trusting them', () => {
    expect(frameHeaders({ embedding: { frameAncestors: ['*'] } })['x-frame-options']).toBe('DENY');
    expect(
      frameHeaders({ embedding: { frameAncestors: ["https://a.example.com 'unsafe-inline'"] } })[
        'x-frame-options'
      ],
    ).toBe('DENY');
  });

  it.each([
    ['https://apps.mypurecloud.com', true],
    ['https://avaya.example.com:8443', true],
    ['https://*.salesforce.com', true],
    ['http://crm.example.com', false],
    ['https://*', false],
    ['https://*.com', false],
    ['*', false],
    ['https://crm.example.com/path', false],
    ['https://crm.example.com;script-src', false],
    ['data:', false],
  ])('%s valid=%s', (value, valid) => {
    expect(FrameAncestorSchema.safeParse(value).success).toBe(valid);
  });
});
