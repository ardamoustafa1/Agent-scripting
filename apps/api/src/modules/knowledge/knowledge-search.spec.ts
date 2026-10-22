import { describe, expect, it } from 'vitest';

import { MAX_TERMS, searchColumns, searchTerms, snippet, tsQuery } from './knowledge-search.js';

describe('knowledge search text (ADR-0057)', () => {
  it('folds the query Turkish-aware and keeps letters and digits only', () => {
    expect(searchTerms("İADE süresi: 14 GÜN? 'iade' & (kart)|!:*")).toEqual([
      'iade',
      'suresi',
      '14',
      'gun',
      'kart',
    ]);
    expect(searchTerms('…')).toEqual([]);
    expect(
      searchTerms(Array.from({ length: 20 }, (_, i) => `w${String(i)}`).join(' ')),
    ).toHaveLength(MAX_TERMS);
  });

  it('builds prefix queries for words of three letters or more', () => {
    expect(tsQuery(['iade', 'ne', '14'], 'all')).toBe('iade:* & ne & 14');
    expect(tsQuery([], 'all')).toBeNull();
  });

  it('drops stop words from the any-word fallback, and gives up when nothing is left', () => {
    expect(tsQuery(['kart', 'nasil', 'iptal', 'edilir'], 'any')).toBe(
      'kart:* | iptal:* | edilir:*',
    );
    expect(tsQuery(['ne', 'nasil'], 'any')).toBeNull();
  });

  it('writes folded search columns from the title, tags and the body without markers', () => {
    expect(
      searchColumns({
        title: 'Kredi Kartı İadesi',
        tags: ['İade', 'kart-iptal'],
        body: '## Adımlar\n- Kimliği doğrula',
      }),
    ).toEqual({
      searchTitle: 'kredi karti iadesi',
      searchTags: 'iade kart iptal',
      searchBody: 'adimlar kimligi dogrula',
    });
  });

  it('cuts a snippet around the first matching word, between words', () => {
    const body = `${'Giriş metni burada uzun uzun anlatılır. '.repeat(8)}İade 14 gün içinde yapılır. ${'Son. '.repeat(40)}`;
    const cut = snippet(body, ['iade']);
    expect(cut.startsWith('…')).toBe(true);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut).toContain('İade 14 gün içinde yapılır.');
    expect(cut.length).toBeLessThanOrEqual(202);
    expect(snippet('## Kısa\n- metin', ['yok'])).toBe('Kısa metin');
    expect(snippet('a '.repeat(300), ['zzz']).startsWith('a a')).toBe(true);
  });
});
