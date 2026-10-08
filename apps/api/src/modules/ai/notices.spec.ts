import { describe, expect, it } from 'vitest';

import { ScriptDocumentSchema } from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';

import { MAX_NOTICES, noticeChoices } from './notices.js';

function documentWithNotices() {
  const doc = ScriptDocumentSchema.parse(minimalScript());
  doc.i18n.messages['en'] = {
    ...doc.i18n.messages['en'],
    'legal.title': 'Recording notice',
    'legal.text': 'This call may be recorded.',
    'legal.extra': 'You may object.',
  };
  doc.i18n.messages['tr'] = {
    ...doc.i18n.messages['tr'],
    'legal.title': 'Kayıt bildirimi',
    'legal.text': 'Bu görüşme kaydedilebilir.',
  };
  doc.pages[0]!.layout.children = [
    {
      id: 'notice-a',
      type: 'scriptText',
      props: {
        mustRead: true,
        titleKey: 'legal.title',
        textKey: 'legal.text',
        blocks: [{ textKey: 'legal.extra' }, null, { textKey: 'missing.key' }],
      },
      bindings: [],
      events: {},
    },
    { id: 'plain', type: 'scriptText', props: { textKey: 'legal.text' }, bindings: [], events: {} },
    { id: 'notice-b', type: 'scriptText', props: { mustRead: true }, bindings: [], events: {} },
  ] as never;
  return doc;
}

describe('noticeChoices', () => {
  it('lists only mandatory notices with the wording of the requested locale', () => {
    expect(noticeChoices(documentWithNotices(), 'en')).toEqual([
      {
        id: 'notice-a',
        title: 'Recording notice',
        text: 'This call may be recorded.\nYou may object.',
      },
      { id: 'notice-b', title: '', text: '' },
    ]);
  });

  it('falls back to the default locale for missing translations', () => {
    const [first] = noticeChoices(documentWithNotices(), 'tr');
    expect(first).toEqual({
      id: 'notice-a',
      title: 'Kayıt bildirimi',
      // `legal.extra` only exists in English; the default locale (tr) has no entry either.
      text: 'Bu görüşme kaydedilebilir.',
    });
  });

  it('bounds the wording and the number of notices', () => {
    const doc = documentWithNotices();
    doc.i18n.messages['en']!['legal.text'] = 'x'.repeat(5000);
    expect(noticeChoices(doc, 'en')[0]?.text.length).toBe(1500);
    doc.pages[0]!.layout.children = Array.from({ length: MAX_NOTICES + 5 }, (_, index) => ({
      id: `n-${String(index)}`,
      type: 'scriptText',
      props: { mustRead: true },
      bindings: [],
      events: {},
    }));
    expect(noticeChoices(doc, 'en')).toHaveLength(MAX_NOTICES);
  });
});
