import { describe, expect, it } from 'vitest';

import {
  ScriptDocumentSchema,
  validateSemantics,
  type ScriptDocument,
} from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';

import {
  actionMessageKeys,
  alertKey,
  dropMessages,
  flowPages,
  newTrigger,
  newTriggerId,
  noticeChoices,
  parsePhrases,
  scriptLocales,
  tryTriggers,
} from './model.js';

function document(): ScriptDocument {
  const doc = ScriptDocumentSchema.parse(minimalScript());
  doc.pages.push({
    ...structuredClone(doc.pages[0]!),
    id: 'detour',
    name: 'Detour',
    layout: { id: 'detour-root', type: 'box', props: {}, children: [], bindings: [], events: {} },
  });
  doc.pages[0]!.layout.children!.push({
    id: 'notice-recording',
    type: 'scriptText',
    props: { mustRead: true, titleKey: 'notice.title', textKey: 'common.next' },
    children: [],
    bindings: [],
    events: {},
  });
  doc.i18n.messages['tr'] = { ...doc.i18n.messages['tr'], 'notice.title': 'Kayıt bildirimi' };
  doc.i18n.messages['en'] = { ...doc.i18n.messages['en'], 'notice.title': 'Recording notice' };
  return doc;
}

describe('trigger editor model', () => {
  it('offers only main-flow steps and named must-read notices', () => {
    const doc = document();
    expect(flowPages(doc)).toEqual([{ id: 'home', name: 'Home' }]);
    expect(noticeChoices(doc)).toEqual([{ id: 'notice-recording', name: 'Kayıt bildirimi' }]);
    expect(scriptLocales(doc)).toEqual(['tr', 'en']);
  });

  it('parses one phrase per line, trimmed, deduplicated and bounded', () => {
    expect(parsePhrases('  iptal etmek \n\nİPTAL ETMEK\nfatura\n')).toEqual([
      'iptal etmek',
      'fatura',
    ]);
    expect(parsePhrases('x'.repeat(100))[0]).toHaveLength(80);
    expect(
      parsePhrases(Array.from({ length: 30 }, (_, i) => `p${String(i)}`).join('\n')),
    ).toHaveLength(20);
  });

  it('creates a valid trigger with a fresh id and hint key', () => {
    const doc = document();
    const values = ['aaaa1111', 'aaaa1111', 'bbbb2222'];
    doc.triggers = [newTrigger(doc, 'trigger-aaaa1111', 'Taken')];
    const id = newTriggerId(doc, () => values.shift() ?? 'zzzz');
    expect(id).toBe('trigger-bbbb2222');
    const created = newTrigger(doc, id, 'Cancel');
    expect(created.actions).toEqual([
      { type: 'alert', messageKey: 'triggers.triggerbbbb2222.alert1', tone: 'info' },
    ]);
    expect(created.phrases).toEqual({ tr: [], en: [] });
    doc.triggers.push({ ...created, phrases: { tr: ['iptal'], en: [] } });
    doc.triggers[0]!.phrases = { tr: ['fatura'], en: [] };
    for (const key of actionMessageKeys(doc.triggers.flatMap((t) => t.actions)))
      for (const locale of ['tr', 'en']) doc.i18n.messages[locale]![key] = 'Hint';
    expect(validateSemantics(doc).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('finds the next free hint key and drops keys from every locale', () => {
    const doc = document();
    doc.i18n.messages['tr']!['triggers.triggerx.alert1'] = 'a';
    expect(alertKey(doc, 'trigger-x')).toBe('triggers.triggerx.alert2');
    dropMessages(doc, ['triggers.triggerx.alert1', 'common.next']);
    expect(doc.i18n.messages['tr']).toEqual({ 'notice.title': 'Kayıt bildirimi' });
    expect(doc.i18n.messages['en']).toEqual({ 'notice.title': 'Recording notice' });
    const untouched = structuredClone(doc.i18n.messages);
    dropMessages(doc, []);
    expect(doc.i18n.messages).toEqual(untouched);
  });

  it('tries a sentence with the call matcher, ignoring page scope', () => {
    const doc = document();
    doc.triggers = [
      {
        ...newTrigger(doc, 'trigger-a', 'Cancel'),
        phrases: { tr: ['iptal'], en: [] },
        pages: ['detour'],
      },
      {
        ...newTrigger(doc, 'trigger-b', 'Off'),
        enabled: false,
        phrases: { tr: ['iptal'], en: [] },
      },
      {
        ...newTrigger(doc, 'trigger-c', 'Agent'),
        speaker: 'agent',
        phrases: { tr: ['kayıt'], en: [] },
      },
    ];
    expect(tryTriggers(doc, 'İptalini istiyorum', 'customer')).toEqual([
      { id: 'trigger-a', name: 'Cancel', phrase: 'iptal' },
    ]);
    expect(tryTriggers(doc, 'Görüşme kayıt altındadır', 'customer')).toEqual([]);
    expect(tryTriggers(doc, 'Görüşme kayıt altındadır', 'agent')).toEqual([
      { id: 'trigger-c', name: 'Agent', phrase: 'kayıt' },
    ]);
  });
});
