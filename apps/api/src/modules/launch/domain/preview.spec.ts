import { describe, expect, it } from 'vitest';

import { previewMayUseLiveData } from './preview.js';

describe('previewMayUseLiveData', () => {
  it('leaves interaction sessions alone', () => {
    expect(previewMayUseLiveData({ kind: 'interaction', decisionTrace: null })).toBe(true);
  });
  it('allows live data for previews only when explicitly granted', () => {
    expect(
      previewMayUseLiveData({
        kind: 'preview',
        decisionTrace: { preview: true, liveDataSources: true },
      }),
    ).toBe(true);
    expect(
      previewMayUseLiveData({
        kind: 'preview',
        decisionTrace: { preview: true, liveDataSources: false },
      }),
    ).toBe(false);
    expect(previewMayUseLiveData({ kind: 'preview', decisionTrace: null })).toBe(false);
    expect(
      previewMayUseLiveData({ kind: 'preview', decisionTrace: { liveDataSources: true } }),
    ).toBe(false);
  });
});
