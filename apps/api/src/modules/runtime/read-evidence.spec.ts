import { expect, it } from 'vitest';

import { acknowledgementCurrent, readEvidenceChecksum } from './read-evidence.js';

const base = { pageId: 'home', nodeId: 'terms', props: { mustRead: true, text: 'Version A' } };
it('is deterministic and independent of prop order', () => {
  const reordered = { ...base, props: { text: 'Version A', mustRead: true } };
  expect(readEvidenceChecksum(base)).toBe(readEvidenceChecksum(reordered));
  expect(readEvidenceChecksum(base)).toMatch(/^[0-9a-f]{64}$/);
});
it('invalidates an old acknowledgement when the text, node or page changes', () => {
  const recorded = readEvidenceChecksum(base);
  expect(acknowledgementCurrent(recorded, readEvidenceChecksum(base))).toBe(true);
  for (const changed of [
    { ...base, props: { ...base.props, text: 'Version B' } },
    { ...base, nodeId: 'other' },
    { ...base, pageId: 'page-2' },
  ])
    expect(acknowledgementCurrent(recorded, readEvidenceChecksum(changed))).toBe(false);
  expect(acknowledgementCurrent(undefined, recorded)).toBe(false);
});
