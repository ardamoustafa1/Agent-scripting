import type { ScriptDocument } from '@verbis/script-schema';

/** Keyboard intents of the agent desktop (DIFFERENTIATORS D4). */
export type ShortcutIntent =
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'help' }
  | { type: 'focusMode' }
  | { type: 'tab'; index: number };

export interface ShortcutEvent {
  key: string;
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  isComposing: boolean;
}

/** Where the key was pressed, which decides what a plain key may mean. */
export interface ShortcutTarget {
  /** Typing text (input, textarea, contenteditable, combobox). */
  typing: boolean;
  /** A field that uses Enter itself (textarea, contenteditable, combobox). */
  multiline: boolean;
  /** On an activatable control (button, link) whose own Enter must win. */
  control: boolean;
  /** Inside a dialog: shortcuts never act behind a modal. */
  dialog: boolean;
}

export function describeTarget(target: EventTarget | null): ShortcutTarget {
  if (!(target instanceof HTMLElement))
    return { typing: false, multiline: false, control: false, dialog: false };
  const multiline = Boolean(
    target.isContentEditable || target.closest('textarea,[contenteditable=true],[role=combobox]'),
  );
  const typing =
    multiline ||
    (target instanceof HTMLInputElement &&
      !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(
        target.type,
      ));
  return {
    typing,
    multiline,
    control: Boolean(target.closest('button,a,[role=radio],[role=checkbox],[role=switch]')),
    dialog: Boolean(target.closest('[role=dialog],[role=alertdialog]')),
  };
}

/**
 * Enter advances unless a control or multi-line field owns it; Ctrl/⌘+Enter advances even
 * from those (notes, long answers); Alt+← goes back; ? or Ctrl+/ toggles help; Alt+F toggles focus mode;
 * Alt+1…9 picks an interaction. Physical key codes keep Alt shortcuts layout-independent.
 */
export function shortcutIntent(event: ShortcutEvent, at: ShortcutTarget): ShortcutIntent | null {
  if (event.isComposing || at.dialog) return null;
  const mod = event.ctrlKey || event.metaKey;
  if (event.ctrlKey && event.key === '/') return { type: 'help' };
  if (event.key === 'Enter' && mod && !event.altKey && !event.shiftKey) return { type: 'next' };
  if (event.altKey && !mod && !event.shiftKey) {
    if (event.key === 'ArrowLeft' && !at.typing) return { type: 'back' };
    if (at.typing) return null;
    if (event.code === 'KeyF') return { type: 'focusMode' };
    const digit = /^Digit([1-9])$/.exec(event.code)?.[1];
    if (digit) return { type: 'tab', index: Number(digit) - 1 };
    return null;
  }
  if (mod || event.altKey) return null;
  // A single-line answer followed by Enter moves on, as agents expect; multi-line fields keep it.
  if (event.key === 'Enter' && !event.shiftKey && !at.control && !at.multiline)
    return { type: 'next' };
  if (event.key === '?' && !at.typing) return { type: 'help' };
  return null;
}

export interface Step {
  id: string;
  title: string;
}

/** Customer-facing page title (its title key), falling back to the designer's page name. */
export function pageTitle(
  document: ScriptDocument,
  pageId: string,
  message: (key: string) => string,
): string {
  const page = document.pages.find((candidate) => candidate.id === pageId);
  if (!page) return pageId;
  return page.titleKey ? message(page.titleKey) : page.name;
}

/** The pages already completed, most recent last, without the current one. Bounded for display. */
export function stepTrail(
  document: ScriptDocument,
  history: readonly string[],
  current: string | null,
  message: (key: string) => string,
  limit = 12,
): Step[] {
  return history
    .filter((id) => id !== current)
    .slice(-limit)
    .map((id) => ({ id, title: pageTitle(document, id, message) }));
}

/** The first field of a freshly shown page, so typing can start at once; otherwise its heading. */
export function pageFocusTarget(root: ParentNode, heading: HTMLElement | null): HTMLElement | null {
  const field = root.querySelector<HTMLElement>(
    [
      'input:not([type=hidden]):not([disabled])',
      'textarea:not([disabled])',
      'select:not([disabled])',
      '[role=radiogroup] [role=radio][tabindex="0"]',
      '[role=combobox]:not([aria-disabled=true])',
    ].join(','),
  );
  return field ?? heading;
}
