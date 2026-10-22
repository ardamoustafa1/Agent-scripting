import type { ScriptTrigger, TriggerAction } from './schema/trigger.js';

/**
 * Live transcript phrase matching (ADR-0052, 2026-10-22). Shared by the API, which evaluates
 * final segments of a call, and the designer's "try a sentence" box, so both agree exactly.
 */

/** Phrase words shorter than this must match a whole word; longer ones match a word's start. */
export const MIN_PREFIX_LENGTH = 3;

/**
 * Turkish-aware folding: Turkish lower-casing (`İ` → `i`, `I` → `ı`), diacritics removed and
 * `ı` → `i`, so "ŞİKÂYET", "şikayet" and "sikayet" compare equal. English text folds the same way.
 */
export function foldText(text: string): string {
  return text.toLocaleLowerCase('tr').normalize('NFKD').replace(/\p{M}/gu, '').replace(/ı/g, 'i');
}

/** Folded words (letters and digits); punctuation and spacing never matter. */
export function textWords(text: string): string[] {
  return foldText(text).match(/[\p{L}\p{N}]+/gu) ?? [];
}

const wordMatches = (phraseWord: string, word: string): boolean =>
  phraseWord.length < MIN_PREFIX_LENGTH ? word === phraseWord : word.startsWith(phraseWord);

/**
 * Whether the phrase's words occur consecutively in `words`. Each phrase word matches a word that
 * starts with it, so Turkish suffixes still match ("iptal" → "iptalini").
 */
export function matchPhrase(phrase: string, words: readonly string[]): boolean {
  const wanted = textWords(phrase);
  if (wanted.length === 0 || wanted.length > words.length) return false;
  for (let start = 0; start + wanted.length <= words.length; start += 1)
    if (wanted.every((phraseWord, offset) => wordMatches(phraseWord, words[start + offset] ?? '')))
      return true;
  return false;
}

/** Phrases that apply to a segment: its own language (or base language) when the trigger has it. */
export function phrasesFor(trigger: ScriptTrigger, language?: string): readonly string[] {
  if (language !== undefined) {
    const own = trigger.phrases[language] ?? trigger.phrases[language.slice(0, 2)];
    if (own !== undefined && own.length > 0) return own;
  }
  return Object.values(trigger.phrases).flat();
}

/** First phrase of the trigger found in the text, if any. */
export function matchingPhrase(
  trigger: ScriptTrigger,
  text: string,
  language?: string,
): string | null {
  const words = textWords(text);
  return phrasesFor(trigger, language).find((phrase) => matchPhrase(phrase, words)) ?? null;
}

export interface TranscriptLine {
  readonly segmentId: string;
  readonly speaker: 'customer' | 'agent';
  readonly text: string;
  readonly language?: string | undefined;
  /** Epoch milliseconds. */
  readonly at: number;
}

export interface TriggerHistoryEntry {
  readonly triggerId: string;
  readonly segmentId: string;
  /** Epoch milliseconds. */
  readonly at: number;
}

export interface TriggerFiring {
  readonly trigger: ScriptTrigger;
  readonly phrase: string;
  /** Actions still useful on the current page (a suggestion of the shown page is dropped). */
  readonly actions: readonly TriggerAction[];
}

/**
 * Triggers that fire for one final segment. Deterministic: the same document, line, page and
 * history always give the same result, and a re-delivered segment never fires a trigger twice.
 */
export function evaluateTriggers(
  triggers: readonly ScriptTrigger[] | undefined,
  line: TranscriptLine,
  context: {
    readonly currentPage: string | null;
    readonly history: readonly TriggerHistoryEntry[];
  },
): TriggerFiring[] {
  const firings: TriggerFiring[] = [];
  for (const trigger of triggers ?? []) {
    if (!trigger.enabled) continue;
    if (trigger.speaker !== 'any' && trigger.speaker !== line.speaker) continue;
    if (
      trigger.pages !== undefined &&
      trigger.pages.length > 0 &&
      (context.currentPage === null || !trigger.pages.includes(context.currentPage))
    )
      continue;
    const earlier = context.history.filter((hit) => hit.triggerId === trigger.id);
    if (earlier.some((hit) => hit.segmentId === line.segmentId)) continue;
    const last = Math.max(...earlier.map((hit) => hit.at));
    if (
      earlier.length > 0 &&
      (trigger.repeat === 'once' || line.at - last < trigger.repeat.cooldownSeconds * 1_000)
    )
      continue;
    const actions = trigger.actions.filter(
      (action) => action.type !== 'suggestPage' || action.pageId !== context.currentPage,
    );
    if (actions.length === 0) continue;
    const phrase = matchingPhrase(trigger, line.text, line.language);
    if (phrase !== null) firings.push({ trigger, phrase, actions });
  }
  return firings;
}
