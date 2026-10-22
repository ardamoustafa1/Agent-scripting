import { MIN_PREFIX_LENGTH, foldText, textWords } from '@verbis/script-schema';
import { articlePlainText } from '@verbis/shared-types';

/**
 * Knowledge search text handling (ADR-0057). Folding is the transcript triggers' `foldText`, so
 * "İADE", "iade" and "iadesi" meet the same words. Query words contain letters and digits only,
 * so no user text ever reaches the tsquery syntax.
 */

/** At most this many query words are used. */
export const MAX_TERMS = 12;

/** Common words dropped from the any-word fallback (folded, Turkish and English). */
const STOP_WORDS = new Set([
  'acaba',
  'ama',
  'bir',
  'bu',
  'da',
  'de',
  'icin',
  'ile',
  'mi',
  'mu',
  'nasil',
  'ne',
  'neden',
  'nedir',
  've',
  'veya',
  'ya',
  'a',
  'an',
  'and',
  'are',
  'can',
  'do',
  'for',
  'how',
  'i',
  'is',
  'it',
  'of',
  'or',
  'the',
  'to',
  'what',
  'why',
]);

/** Folded, distinct query words in order. */
export function searchTerms(query: string): string[] {
  return [...new Set(textWords(query))].slice(0, MAX_TERMS);
}

const termQuery = (term: string) => (term.length >= MIN_PREFIX_LENGTH ? `${term}:*` : term);

/**
 * `to_tsquery('simple', …)` text: every word (`all`) or any word without stop words (`any`).
 * Null when nothing searchable is left.
 */
export function tsQuery(terms: readonly string[], mode: 'all' | 'any'): string | null {
  if (mode === 'all') return terms.length === 0 ? null : terms.map(termQuery).join(' & ');
  const meaningful = terms.filter((term) => !STOP_WORDS.has(term));
  return meaningful.length === 0 ? null : meaningful.map(termQuery).join(' | ');
}

/** Columns the search index is generated from. */
export function searchColumns(input: { title: string; tags: readonly string[]; body: string }) {
  return {
    searchTitle: textWords(input.title).join(' '),
    searchTags: input.tags.flatMap((tag) => textWords(tag)).join(' '),
    searchBody: textWords(articlePlainText(input.body)).join(' '),
  };
}

const SNIPPET_BEFORE = 60;
const SNIPPET_LENGTH = 200;

const matches = (word: string, terms: readonly string[]) => {
  const folded = foldText(word);
  return terms.some((term) =>
    term.length < MIN_PREFIX_LENGTH ? folded === term : folded.startsWith(term),
  );
};

/**
 * A short excerpt of the body around the first word that matches, else its beginning.
 * Whitespace is collapsed; cut points fall between words.
 */
export function snippet(body: string, terms: readonly string[]): string {
  const text = articlePlainText(body).replace(/\s+/g, ' ').trim();
  if (text.length <= SNIPPET_LENGTH) return text;
  let at = 0;
  for (const found of text.matchAll(/[\p{L}\p{N}]+/gu))
    if (matches(found[0], terms)) {
      at = found.index;
      break;
    }
  let start = Math.max(0, at - SNIPPET_BEFORE);
  if (start > 0) start = text.indexOf(' ', start) + 1 || start;
  let end = Math.min(text.length, start + SNIPPET_LENGTH);
  if (end < text.length)
    end = text.lastIndexOf(' ', end) > start ? text.lastIndexOf(' ', end) : end;
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}
