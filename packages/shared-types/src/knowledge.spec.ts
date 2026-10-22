import { describe, expect, it } from 'vitest';

import {
  CreateKnowledgeArticleSchema,
  KnowledgeSearchQuerySchema,
  UpdateKnowledgeArticleSchema,
  articlePlainText,
  parseArticleBody,
} from './knowledge.js';

describe('knowledge article inputs (ADR-0057)', () => {
  it('applies defaults, trims and removes repeated tags', () => {
    expect(
      CreateKnowledgeArticleSchema.parse({
        key: 'refund-policy',
        title: ' Refund policy ',
        tags: ['iade', 'iade', 'kart'],
      }),
    ).toEqual({
      key: 'refund-policy',
      title: 'Refund policy',
      body: '',
      tags: ['iade', 'kart'],
      locale: 'tr',
    });
  });

  it('rejects bad keys, empty titles, long bodies, many tags, odd locales and unknown fields', () => {
    const ok = { key: 'refund-policy', title: 'Refund' };
    const bad = (input: Record<string, unknown>) =>
      CreateKnowledgeArticleSchema.safeParse({ ...ok, ...input }).success;
    expect(bad({})).toBe(true);
    expect(bad({ key: 'Refund Policy' })).toBe(false);
    expect(bad({ key: 'a'.repeat(65) })).toBe(false);
    expect(bad({ title: '   ' })).toBe(false);
    expect(bad({ body: 'x'.repeat(20_001) })).toBe(false);
    expect(bad({ tags: Array.from({ length: 11 }, (_, i) => `t${String(i)}`) })).toBe(false);
    expect(bad({ tags: ['x'.repeat(41)] })).toBe(false);
    expect(bad({ locale: 'en-GB' })).toBe(true);
    expect(bad({ locale: 'english' })).toBe(false);
    expect(bad({ status: 'published' })).toBe(false);
  });

  it('never updates the key and needs at least one field', () => {
    expect(UpdateKnowledgeArticleSchema.safeParse({}).success).toBe(false);
    expect(UpdateKnowledgeArticleSchema.safeParse({ key: 'other' }).success).toBe(false);
    expect(UpdateKnowledgeArticleSchema.parse({ title: ' New ' })).toEqual({ title: 'New' });
  });

  it('bounds the search query', () => {
    expect(KnowledgeSearchQuerySchema.parse({ q: ' iade ' })).toEqual({ q: 'iade', limit: 10 });
    expect(KnowledgeSearchQuerySchema.safeParse({ q: ' ' }).success).toBe(false);
    expect(KnowledgeSearchQuerySchema.safeParse({ q: 'x'.repeat(201) }).success).toBe(false);
    expect(KnowledgeSearchQuerySchema.safeParse({ q: 'x', limit: '21' }).success).toBe(false);
  });
});

describe('parseArticleBody', () => {
  it('reads paragraphs, subheadings and lists', () => {
    expect(
      parseArticleBody(
        [
          'Kartınız kaybolduysa:',
          'hemen bloke edin.',
          '',
          '## Adımlar',
          '1. Kimliği doğrulayın',
          '2) Kartı kapatın',
          '- Yeni kart 5 gün içinde gelir',
          '* SMS ile bilgi verilir',
          'Son not',
        ].join('\r\n'),
      ),
    ).toEqual([
      { type: 'paragraph', lines: ['Kartınız kaybolduysa:', 'hemen bloke edin.'] },
      { type: 'heading', text: 'Adımlar' },
      { type: 'list', ordered: true, items: ['Kimliği doğrulayın', 'Kartı kapatın'] },
      {
        type: 'list',
        ordered: false,
        items: ['Yeni kart 5 gün içinde gelir', 'SMS ile bilgi verilir'],
      },
      { type: 'paragraph', lines: ['Son not'] },
    ]);
  });

  it('keeps markup-looking text as text and drops empty headings', () => {
    expect(parseArticleBody('<script>alert(1)</script>\n##   \n-no space')).toEqual([
      { type: 'paragraph', lines: ['<script>alert(1)</script>'] },
      { type: 'paragraph', lines: ['-no space'] },
    ]);
    expect(parseArticleBody('   \n\n')).toEqual([]);
  });

  it('gives the plain text without markers', () => {
    expect(articlePlainText('## Başlık\n- bir\n- iki\n\nmetin')).toBe(
      'Başlık\n\nbir\niki\n\nmetin',
    );
  });
});
