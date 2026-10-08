import { describe, expect, it } from 'vitest';

import { PEER_TONES, followView, peerTone } from './peers.js';

describe('peerTone', () => {
  it('is stable per person and never uses the error colour', () => {
    const id = '01928f3a-0000-7000-8000-000000000042';
    expect(peerTone(id)).toBe(peerTone(id));
    const tones = new Set(
      Array.from({ length: 200 }, (_, i) =>
        peerTone(`01928f3a-0000-7000-8000-${String(i).padStart(12, '0')}`),
      ),
    );
    expect([...tones].every((tone) => (PEER_TONES as readonly string[]).includes(tone))).toBe(true);
    expect(tones.has('danger' as never)).toBe(false);
    // Spread: 200 people use every tone.
    expect(tones.size).toBe(PEER_TONES.length);
  });
});

describe('followView', () => {
  const peers = [
    { userId: 'a', pageId: 'home', selection: ['btn'] },
    { userId: 'b', pageId: 'offer', selection: [] },
  ];
  it('returns the followed colleague’s page and first selected node', () => {
    expect(followView(peers, 'a')).toEqual({ pageId: 'home', nodeId: 'btn' });
    expect(followView(peers, 'b')).toEqual({ pageId: 'offer', nodeId: undefined });
  });
  it('is null when not following or the colleague left', () => {
    expect(followView(peers, null)).toBeNull();
    expect(followView(peers, 'gone')).toBeNull();
  });
});
