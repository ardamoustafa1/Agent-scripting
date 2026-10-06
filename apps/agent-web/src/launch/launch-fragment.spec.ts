import { describe, expect, it, vi } from 'vitest';

import { identifyingParams, parseLaunchFragment, scrubLocation } from './launch-fragment.js';

const code = 'A'.repeat(43);
const connector = '0190f000-0000-7000-8000-000000000001';

describe('parseLaunchFragment', () => {
  it('reads a launch code, a JWS or an embedded hint from the fragment only', () => {
    expect(parseLaunchFragment(`#code=${code}`)).toEqual({ kind: 'code', code });
    expect(parseLaunchFragment('#jws=aaa.bbb.ccc')).toEqual({ kind: 'jws', token: 'aaa.bbb.ccc' });
    expect(parseLaunchFragment(`#connector=${connector}&conversation=conv-1`)).toEqual({
      kind: 'embedded',
      connectorId: connector,
      conversationId: 'conv-1',
    });
  });

  it('rejects malformed material instead of guessing', () => {
    for (const hash of [
      '',
      '#',
      '#code=short',
      '#code=<script>',
      '#jws=a.b',
      '#connector=x&conversation=y',
      `#connector=${connector}&conversation=a b`,
      '#scriptId=1',
    ])
      expect(parseLaunchFragment(hash)).toBeUndefined();
  });
});

describe('identifyingParams', () => {
  it('lists identifying parameters (lower-cased, unique, sorted) and nothing else', () => {
    expect(
      identifyingParams(
        '?scriptId=1&campaignId=2&CampaignId=3&interactionId=4&userId=5&utm_source=x',
      ),
    ).toEqual(['campaignid', 'interactionid', 'scriptid', 'userid']);
    expect(identifyingParams('')).toEqual([]);
  });
});

describe('scrubLocation', () => {
  it('replaces the entry with the bare path (no query, no fragment, no new entry)', () => {
    const replaceState = vi.fn();
    scrubLocation({
      history: { replaceState } as unknown as History,
      location: { pathname: '/launch' } as Location,
    });
    expect(replaceState).toHaveBeenCalledWith(null, '', '/launch');
  });
});
