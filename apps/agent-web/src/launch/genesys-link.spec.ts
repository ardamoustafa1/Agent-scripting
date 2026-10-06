import { describe, expect, it, vi } from 'vitest';

import {
  authorizePath,
  LINK_MESSAGE,
  linkStatusFrom,
  openLinkPopup,
  parseLinkStatus,
} from './genesys-link.js';

const CONNECTOR = '0190f000-0000-7000-8000-00000000c0de';

describe('genesys account link (agent-web)', () => {
  it('opens the BFF authorize endpoint in a popup; never builds URLs from untrusted ids', () => {
    const open = vi.fn(() => null);
    openLinkPopup(CONNECTOR, { open });
    expect(open).toHaveBeenCalledWith(
      `/api/v1/genesys-cloud/connectors/${CONNECTOR}/oauth/authorize`,
      'verbis-genesys-link',
      expect.stringContaining('popup'),
    );
    expect(() => authorizePath('../../admin')).toThrow();
  });

  it('reads only the status from the landing fragment', () => {
    expect(parseLinkStatus('#status=linked')).toBe('linked');
    expect(parseLinkStatus('#status=anything')).toBe('failed');
    expect(parseLinkStatus('')).toBe('failed');
  });

  it('accepts link messages only from its own origin', () => {
    const origin = 'https://acme.agent.example';
    expect(linkStatusFrom({ origin, data: { type: LINK_MESSAGE, status: 'linked' } }, origin)).toBe(
      'linked',
    );
    expect(
      linkStatusFrom(
        { origin: 'https://apps.mypurecloud.de', data: { type: LINK_MESSAGE, status: 'linked' } },
        origin,
      ),
    ).toBeUndefined();
    expect(linkStatusFrom({ origin, data: { type: 'other' } }, origin)).toBeUndefined();
    expect(linkStatusFrom({ origin, data: null }, origin)).toBeUndefined();
  });
});
