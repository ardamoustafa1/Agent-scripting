import { walkNodes, type ScriptDocument } from '@verbis/script-schema';

/**
 * Mandatory notices (`mustRead`) of a script as the model needs them (ADR-0052 E5): the id it may
 * answer with, the title and the wording in the requested locale. Text is bounded; the model only
 * ever points at ids from this list.
 */
export interface NoticeChoice {
  readonly id: string;
  readonly title: string;
  readonly text: string;
}
const MAX_TEXT = 1500;
export const MAX_NOTICES = 50;

export function noticeChoices(document: ScriptDocument, locale: 'tr' | 'en'): NoticeChoice[] {
  const messages = document.i18n.messages;
  const message = (key: unknown): string => {
    if (typeof key !== 'string') return '';
    return messages[locale]?.[key] ?? messages[document.i18n.defaultLocale]?.[key] ?? '';
  };
  const choices: NoticeChoice[] = [];
  walkNodes(document, ({ node }) => {
    if (node.props['mustRead'] !== true || choices.length >= MAX_NOTICES) return true;
    const blocks = Array.isArray(node.props['blocks']) ? node.props['blocks'] : [];
    const text = [
      message(node.props['textKey']),
      ...blocks.map((block: unknown) =>
        message(
          block !== null && typeof block === 'object'
            ? (block as Record<string, unknown>)['textKey']
            : undefined,
        ),
      ),
    ]
      .filter((part) => part !== '')
      .join('\n')
      .slice(0, MAX_TEXT);
    choices.push({
      id: node.id,
      title: message(node.props['titleKey'] ?? node.props['labelKey']),
      text,
    });
    return true;
  });
  return choices;
}
