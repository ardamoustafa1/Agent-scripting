import {
  matchingPhrase,
  TRIGGER_LIMITS,
  walkNodes,
  type ScriptDocument,
  type ScriptTrigger,
  type TriggerAction,
} from '@verbis/script-schema';

/**
 * Pure helpers of the Triggers editor (ADR-0052): live transcript phrase rules authored without
 * JSON. The matching itself is `@verbis/script-schema`, the same code the API runs on a call.
 */

/** Steps a trigger may suggest: page steps of the main flow (the runtime refuses others). */
export function flowPages(document: ScriptDocument): { id: string; name: string }[] {
  const inFlow = new Set(
    document.flow.nodes.flatMap((node) => (node.type === 'page' ? [node.page] : [])),
  );
  return document.pages
    .filter((page) => inFlow.has(page.id))
    .map((page) => ({ id: page.id, name: page.name }));
}

/** Must-read notices, named by their title (or text) in the default locale. */
export function noticeChoices(document: ScriptDocument): { id: string; name: string }[] {
  const messages = document.i18n.messages[document.i18n.defaultLocale] ?? {};
  const choices: { id: string; name: string }[] = [];
  walkNodes(document, ({ node }) => {
    if (node.props['mustRead'] !== true) return true;
    const key = [node.props['titleKey'], node.props['textKey']].find(
      (value): value is string => typeof value === 'string' && Boolean(messages[value]),
    );
    choices.push({ id: node.id, name: key === undefined ? node.id : (messages[key] ?? node.id) });
    return true;
  });
  return choices;
}

/** Locales of the script, default first. */
export function scriptLocales(document: ScriptDocument): string[] {
  const { defaultLocale, messages } = document.i18n;
  return [defaultLocale, ...Object.keys(messages).filter((locale) => locale !== defaultLocale)];
}

/** One phrase per line: trimmed, blank and repeated lines dropped, bounded like the schema. */
export function parsePhrases(text: string): string[] {
  const seen = new Set<string>();
  const phrases: string[] = [];
  for (const raw of text.split('\n')) {
    const phrase = raw.trim().slice(0, TRIGGER_LIMITS.maxPhraseLength).trim();
    const key = phrase.toLocaleLowerCase('tr');
    if (phrase === '' || seen.has(key)) continue;
    seen.add(key);
    phrases.push(phrase);
    if (phrases.length === TRIGGER_LIMITS.maxPhrasesPerLocale) break;
  }
  return phrases;
}

/** A trigger id that is not taken yet (kebab-case, stable once created). */
export function newTriggerId(document: ScriptDocument, random: () => string): string {
  const taken = new Set((document.triggers ?? []).map((trigger) => trigger.id));
  let id = `trigger-${random()}`;
  while (taken.has(id)) id = `trigger-${random()}`;
  return id;
}

export function newTrigger(document: ScriptDocument, id: string, name: string): ScriptTrigger {
  return {
    id,
    name,
    enabled: true,
    phrases: Object.fromEntries(scriptLocales(document).map((locale) => [locale, []])),
    speaker: 'customer',
    repeat: 'once',
    actions: [{ type: 'alert', messageKey: alertKey(document, id), tone: 'info' }],
  };
}

/** A free translation key for a trigger's hint text. */
export function alertKey(document: ScriptDocument, triggerId: string): string {
  const base = `triggers.${triggerId.replaceAll('-', '')}.alert`;
  const used = new Set(Object.values(document.i18n.messages).flatMap((m) => Object.keys(m)));
  let index = 1;
  while (used.has(`${base}${String(index)}`)) index += 1;
  return `${base}${String(index)}`;
}

/** Removes translation keys from every locale (an immer draft or a plain document). */
export function dropMessages(document: ScriptDocument, keys: readonly string[]): void {
  if (keys.length === 0) return;
  for (const [locale, catalog] of Object.entries(document.i18n.messages))
    document.i18n.messages[locale] = Object.fromEntries(
      Object.entries(catalog).filter(([key]) => !keys.includes(key)),
    );
}

/** Translation keys only this trigger's actions use (removed with the action or trigger). */
export function actionMessageKeys(actions: readonly TriggerAction[]): string[] {
  return actions.flatMap((action) => (action.type === 'alert' ? [action.messageKey] : []));
}

export interface TriedTrigger {
  readonly id: string;
  readonly name: string;
  readonly phrase: string;
}

/**
 * Which triggers a sentence would fire, ignoring page scope and repeat rules (those depend on
 * the call). Disabled triggers and the other speaker never fire.
 */
export function tryTriggers(
  document: ScriptDocument,
  sentence: string,
  speaker: 'customer' | 'agent',
): TriedTrigger[] {
  return (document.triggers ?? []).flatMap((trigger) => {
    if (!trigger.enabled || (trigger.speaker !== 'any' && trigger.speaker !== speaker)) return [];
    const phrase = matchingPhrase(trigger, sentence);
    return phrase === null ? [] : [{ id: trigger.id, name: trigger.name, phrase }];
  });
}
