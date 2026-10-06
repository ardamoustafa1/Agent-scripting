import { describe, expect, it } from 'vitest';

import { editorFixture } from './fixtures.js';
import { findComponents, searchText } from './search.js';

describe('authoring search', () => {
  it.each([' İLERİ ', 'ileri', 'ılerı'])('normalizes Turkish human text: %s', (text) => {
    expect(searchText(text)).toBe('ileri');
  });
  it('uses the current language and default fallback only for referenced text keys', () => {
    const doc = editorFixture().document;
    const node = doc.pages[0]!.layout.children![0]!;
    node['props'] = { labelKey: 'delivery.label', hintKey: 'delivery.hint' };
    doc.i18n.messages['en']!['delivery.label'] = 'Delivery assistance';
    doc.i18n.messages['tr']!['delivery.label'] = 'Kargo desteği';
    doc.i18n.messages['tr']!['delivery.hint'] = 'Gönderiyi bulun';
    const label = (type: string) => type;
    expect(findComponents(doc, 'delivery assistance', 'en-US', label).map((n) => n.id)).toEqual([
      'btn-next',
    ]);
    expect(findComponents(doc, 'kargo destegi', 'tr-TR', label).map((n) => n.id)).toEqual([
      'btn-next',
    ]);
    expect(findComponents(doc, 'gonderiyi bulun', 'en', label).map((n) => n.id)).toEqual([
      'btn-next',
    ]);
    expect(findComponents(doc, 'kargo destegi', 'en', label)).toEqual([]);
    expect(findComponents(doc, '  ', 'en', label)).toEqual([]);
  });
  it('finds every instance, nested components, a11y text and raw key without mutating the document', () => {
    const doc = editorFixture().document;
    const second = structuredClone(doc.pages[0]!);
    second.id = 'second';
    second.name = 'Delivery';
    second.layout.id = 'second-root';
    second.layout.children![0]!['id'] = 'second-button';
    doc.pages.push(second);
    doc.pages[0]!.layout.a11y = { labelKey: 'delivery.a11y' };
    doc.i18n.messages['en']!['delivery.a11y'] = 'Welcome layout';
    const before = structuredClone(doc);
    expect(findComponents(doc, 'common.next', 'en', (type) => type).map((n) => n.id)).toEqual([
      'btn-next',
      'second-button',
    ]);
    expect(findComponents(doc, 'welcome layout', 'en', (type) => type).map((n) => n.id)).toEqual([
      'home-root',
    ]);
    expect(doc).toEqual(before);
  });
});
