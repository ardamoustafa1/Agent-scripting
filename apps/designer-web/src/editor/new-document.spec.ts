import { describe, expect, it } from 'vitest';

import { validateScriptDocument } from '@verbis/script-schema';

import { newDocument } from './new-document.js';

const input = {
  id: '01928f3a-0000-7000-8000-000000000002',
  name: 'Synthetic draft',
  pageName: 'Synthetic page',
  next: { tr: 'İleri', en: 'Next' },
};
describe('first authoring draft', () => {
  it('is semantically valid, navigable and contains no service credentials or customer values', () => {
    const draft = newDocument(input);
    expect(validateScriptDocument(draft).ok).toBe(true);
    expect(draft.meta.name).toBe(input.name);
    expect(draft.pages[0]?.name).toBe(input.pageName);
    expect(draft.flow.start).toBe('n-home');
    expect(draft.i18n.messages['tr']?.['common.next']).toBe('İleri');
    expect(draft.i18n.messages['en']?.['common.next']).toBe('Next');
    expect(draft.dataSources).toEqual([]);
    expect(draft.variables).toEqual([]);
  });
  it('does not share mutable content between script drafts', () => {
    const first = newDocument(input),
      second = newDocument(input);
    first.pages[0]!.name = 'Changed';
    expect(second.pages[0]?.name).toBe(input.pageName);
    expect(second.pages[0]?.layout).not.toBe(first.pages[0]?.layout);
  });
});
