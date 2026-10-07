import { draftNote, type SummaryLine } from './change-summary.js';

type Translate = (key: string, options?: Record<string, unknown>) => string;

const list = (names: readonly string[]): string => names.join(', ');

/** One localized sentence per summary line; empty parts are left out, never printed as "none". */
export function describeLine(line: SummaryLine, t: Translate): string {
  const k = (key: string) => `designer.lifecycle.summary.${key}`;
  switch (line.key) {
    case 'pages':
      return [
        line.added.length > 0 ? t(k('pagesAdded'), { names: list(line.added) }) : '',
        line.removed.length > 0 ? t(k('pagesRemoved'), { names: list(line.removed) }) : '',
        line.changed.length > 0 ? t(k('pagesChanged'), { names: list(line.changed) }) : '',
      ]
        .filter(Boolean)
        .join('; ');
    case 'variables':
      return [
        line.added.length > 0 ? t(k('variablesAdded'), { names: list(line.added) }) : '',
        line.removed.length > 0 ? t(k('variablesRemoved'), { names: list(line.removed) }) : '',
      ]
        .filter(Boolean)
        .join('; ');
    case 'dataSources':
      return [
        line.added.length > 0 ? t(k('dataSourcesAdded'), { names: list(line.added) }) : '',
        line.removed.length > 0 ? t(k('dataSourcesRemoved'), { names: list(line.removed) }) : '',
        line.changed.length > 0 ? t(k('dataSourcesChanged'), { names: list(line.changed) }) : '',
      ]
        .filter(Boolean)
        .join('; ');
    default:
      return t(k(line.key), { ...line });
  }
}

export function draftFromChanges(lines: readonly SummaryLine[], t: Translate): string {
  return draftNote(lines, (line) => describeLine(line, t));
}
