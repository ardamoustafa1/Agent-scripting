import { describe, expect, it } from 'vitest';

import { TriggerSchema, type ScriptTriggerInput } from './schema/trigger.js';
import {
  evaluateTriggers,
  foldText,
  matchPhrase,
  matchingPhrase,
  phrasesFor,
  textWords,
  type TranscriptLine,
} from './triggers.js';

const trigger = (input: Partial<ScriptTriggerInput> = {}) =>
  TriggerSchema.parse({
    id: 'cancel-intent',
    name: 'Cancel intent',
    phrases: { tr: ['iptal etmek', 'aboneliğimi kapat'], en: ['cancel'] },
    actions: [{ type: 'suggestPage', pageId: 'retention' }],
    ...input,
  });
const line = (text: string, input: Partial<TranscriptLine> = {}): TranscriptLine => ({
  segmentId: 'seg-1',
  speaker: 'customer',
  text,
  at: 1_000_000,
  ...input,
});
const none = { currentPage: 'home', history: [] } as const;

describe('foldText / textWords', () => {
  it('folds Turkish and English casing and diacritics the same way', () => {
    expect(foldText('ŞİKÂYET')).toBe('sikayet');
    expect(foldText('Iğdır')).toBe('igdir');
    expect(foldText('ışık')).toBe('isik');
    expect(foldText('I WANT')).toBe('i want');
  });

  it('splits on punctuation and keeps digits', () => {
    expect(textWords('  Kart-numaram: 4 haneli, değil mi?')).toEqual([
      'kart',
      'numaram',
      '4',
      'haneli',
      'degil',
      'mi',
    ]);
    expect(textWords('...')).toEqual([]);
  });
});

describe('matchPhrase', () => {
  const words = textWords('Aboneliğimi iptal etmek istiyorum, çok pahalı.');

  it('matches consecutive words with Turkish suffixes', () => {
    expect(matchPhrase('iptal etmek', words)).toBe(true);
    expect(matchPhrase('IPTAL', words)).toBe(true);
    expect(matchPhrase('abonelik', words)).toBe(false);
    expect(matchPhrase('aboneli', words)).toBe(true);
    expect(matchPhrase('pahalı', words)).toBe(true);
  });

  it('needs the words in order and next to each other', () => {
    expect(matchPhrase('etmek iptal', words)).toBe(false);
    expect(matchPhrase('iptal istiyorum', words)).toBe(false);
  });

  it('matches short words only as whole words', () => {
    expect(matchPhrase('ok', textWords('çok iyi'))).toBe(false);
    expect(matchPhrase('çok', textWords('çok iyi'))).toBe(true);
    expect(matchPhrase('no', textWords('no thanks'))).toBe(true);
    expect(matchPhrase('no', textWords('not now'))).toBe(false);
  });

  it('never matches an empty phrase or a phrase longer than the text', () => {
    expect(matchPhrase('  ', words)).toBe(false);
    expect(matchPhrase('iptal etmek istiyorum çok pahalı ama yine de', words)).toBe(false);
  });
});

describe('phrasesFor / matchingPhrase', () => {
  it('uses the segment language, its base language, or every locale', () => {
    const t = trigger();
    expect(phrasesFor(t, 'en')).toEqual(['cancel']);
    expect(phrasesFor(t, 'tr-TR')).toEqual(['iptal etmek', 'aboneliğimi kapat']);
    expect(phrasesFor(t, 'de')).toEqual(['iptal etmek', 'aboneliğimi kapat', 'cancel']);
    expect(phrasesFor(t)).toHaveLength(3);
  });

  it('returns the first matching phrase', () => {
    expect(matchingPhrase(trigger(), 'Aboneliğimi kapatın lütfen')).toBe('aboneliğimi kapat');
    expect(matchingPhrase(trigger(), 'I want to cancel', 'en')).toBe('cancel');
    expect(matchingPhrase(trigger(), 'Merhaba')).toBeNull();
  });
});

describe('evaluateTriggers', () => {
  it('fires a matching trigger with its actions', () => {
    const [firing, ...rest] = evaluateTriggers([trigger()], line('iptal etmek istiyorum'), none);
    expect(rest).toEqual([]);
    expect(firing?.trigger.id).toBe('cancel-intent');
    expect(firing?.phrase).toBe('iptal etmek');
    expect(firing?.actions).toEqual([{ type: 'suggestPage', pageId: 'retention' }]);
  });

  it('ignores missing sections, disabled triggers and the other speaker', () => {
    expect(evaluateTriggers(undefined, line('iptal etmek'), none)).toEqual([]);
    expect(evaluateTriggers([trigger({ enabled: false })], line('iptal etmek'), none)).toEqual([]);
    expect(evaluateTriggers([trigger()], line('iptal etmek', { speaker: 'agent' }), none)).toEqual(
      [],
    );
    expect(
      evaluateTriggers(
        [trigger({ speaker: 'any' })],
        line('iptal etmek', { speaker: 'agent' }),
        none,
      ),
    ).toHaveLength(1);
    expect(
      evaluateTriggers(
        [trigger({ speaker: 'agent' })],
        line('iptal etmek', { speaker: 'agent' }),
        none,
      ),
    ).toHaveLength(1);
  });

  it('respects the page scope', () => {
    const scoped = trigger({ pages: ['offer'] });
    expect(evaluateTriggers([scoped], line('iptal etmek'), none)).toEqual([]);
    expect(
      evaluateTriggers([scoped], line('iptal etmek'), { currentPage: null, history: [] }),
    ).toEqual([]);
    expect(
      evaluateTriggers([scoped], line('iptal etmek'), { currentPage: 'offer', history: [] }),
    ).toHaveLength(1);
    expect(evaluateTriggers([trigger({ pages: [] })], line('iptal etmek'), none)).toHaveLength(1);
  });

  it('fires once per session by default and never twice for the same segment', () => {
    const history = [{ triggerId: 'cancel-intent', segmentId: 'seg-0', at: 0 }];
    expect(evaluateTriggers([trigger()], line('iptal etmek'), { ...none, history })).toEqual([]);
    const cooled = trigger({ repeat: { cooldownSeconds: 30 } });
    expect(
      evaluateTriggers([cooled], line('iptal etmek', { at: 29_999 }), { ...none, history }),
    ).toEqual([]);
    expect(
      evaluateTriggers([cooled], line('iptal etmek', { at: 30_000 }), { ...none, history }),
    ).toHaveLength(1);
    const same = [{ triggerId: 'cancel-intent', segmentId: 'seg-1', at: 0 }];
    expect(
      evaluateTriggers([cooled], line('iptal etmek', { at: 999_999 }), { ...none, history: same }),
    ).toEqual([]);
  });

  it('drops a suggestion of the page already shown', () => {
    const onTarget = { currentPage: 'retention', history: [] };
    expect(evaluateTriggers([trigger()], line('iptal etmek'), onTarget)).toEqual([]);
    const mixed = trigger({
      actions: [
        { type: 'suggestPage', pageId: 'retention' },
        { type: 'alert', messageKey: 'hint.cancel' },
      ],
    });
    expect(evaluateTriggers([mixed], line('iptal etmek'), onTarget)[0]?.actions).toEqual([
      { type: 'alert', messageKey: 'hint.cancel', tone: 'info' },
    ]);
  });

  it('returns every trigger that matches, in document order', () => {
    const second = trigger({
      id: 'price',
      phrases: { tr: ['pahalı'] },
      actions: [{ type: 'markNotice', noticeId: 'price-notice' }],
    });
    expect(
      evaluateTriggers([trigger(), second], line('pahalı, iptal etmek istiyorum'), none).map(
        (f) => f.trigger.id,
      ),
    ).toEqual(['cancel-intent', 'price']);
  });
});

describe('TriggerSchema', () => {
  it('applies defaults', () => {
    const parsed = trigger();
    expect(parsed.enabled).toBe(true);
    expect(parsed.speaker).toBe('customer');
    expect(parsed.repeat).toBe('once');
  });

  it('rejects out-of-range input', () => {
    const bad = (input: Partial<ScriptTriggerInput>) =>
      TriggerSchema.safeParse({
        id: 't',
        name: 'T',
        phrases: { tr: ['x'] },
        actions: [{ type: 'alert', messageKey: 'a.b' }],
        ...input,
      }).success;
    expect(bad({})).toBe(true);
    expect(bad({ id: 'Not Kebab' })).toBe(false);
    expect(bad({ actions: [] })).toBe(false);
    expect(
      bad({ actions: Array.from({ length: 4 }, () => ({ type: 'alert', messageKey: 'a.b' })) }),
    ).toBe(false);
    expect(bad({ phrases: { tr: ['x'.repeat(81)] } })).toBe(false);
    expect(bad({ phrases: { tr: Array.from({ length: 21 }, (_, i) => `p${String(i)}`) } })).toBe(
      false,
    );
    expect(bad({ phrases: { TR: ['x'] } })).toBe(false);
    expect(bad({ repeat: { cooldownSeconds: 5 } })).toBe(false);
    expect(bad({ repeat: { cooldownSeconds: 3_601 } })).toBe(false);
  });
});
