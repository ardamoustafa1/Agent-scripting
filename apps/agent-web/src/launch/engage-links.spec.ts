import { afterEach, describe, expect, it, vi } from 'vitest';

import { engageAuthorizePath, fetchEngageLinks, openEngageLinkPopup } from './engage-links.js';

const CONNECTOR = '0190f000-0000-7000-8000-00000000e001';

describe('engage links (agent-web)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('opens the BFF authorize endpoint in the shared link popup', () => {
    const open = vi.fn(() => null);
    openEngageLinkPopup(CONNECTOR, { open });
    expect(open).toHaveBeenCalledWith(
      `/api/v1/genesys-engage/connectors/${CONNECTOR}/oauth/authorize`,
      'verbis-genesys-link',
      expect.any(String),
    );
    expect(() => engageAuthorizePath('x/../../y')).toThrow();
  });

  it('treats errors and malformed answers as "no links"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 401 }))),
    );
    expect(await fetchEngageLinks()).toEqual([]);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json([{ connectorId: 'nope' }]))),
    );
    expect(await fetchEngageLinks()).toEqual([]);
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          Response.json([{ connectorId: CONNECTOR, linked: false, expiresAt: null }]),
        ),
      ),
    );
    expect(await fetchEngageLinks()).toEqual([
      { connectorId: CONNECTOR, linked: false, expiresAt: null },
    ]);
  });
});
