import { describe, expect, it } from 'vitest';

import {
  describeTarget,
  pageFocusTarget,
  shortcutIntent,
  type ShortcutEvent,
  type ShortcutTarget,
} from './navigation.js';

const key = (init: Partial<ShortcutEvent>): ShortcutEvent => ({
  key: '',
  code: '',
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  isComposing: false,
  ...init,
});
const at = (init: Partial<ShortcutTarget> = {}): ShortcutTarget => ({
  typing: false,
  multiline: false,
  control: false,
  dialog: false,
  ...init,
});
const singleLine = at({ typing: true });
const multiLine = at({ typing: true, multiline: true });

describe('shortcutIntent', () => {
  it.each([
    ['Enter on the page', key({ key: 'Enter' }), at(), 'next'],
    ['Enter after a single-line answer', key({ key: 'Enter' }), singleLine, 'next'],
    ['Enter in a multi-line field', key({ key: 'Enter' }), multiLine, null],
    ['Enter on a button', key({ key: 'Enter' }), at({ control: true }), null],
    ['Shift+Enter', key({ key: 'Enter', shiftKey: true }), at(), null],
    ['Ctrl+Enter in a multi-line field', key({ key: 'Enter', ctrlKey: true }), multiLine, 'next'],
    ['⌘+Enter on a button', key({ key: 'Enter', metaKey: true }), at({ control: true }), 'next'],
    ['Alt+← on the page', key({ key: 'ArrowLeft', altKey: true }), at(), 'back'],
    ['Alt+← while typing (word jump)', key({ key: 'ArrowLeft', altKey: true }), singleLine, null],
    ['?', key({ key: '?' }), at(), 'help'],
    ['? while typing', key({ key: '?' }), singleLine, null],
    ['Ctrl+/ while typing', key({ key: '/', ctrlKey: true }), multiLine, 'help'],
    ['Alt+F', key({ key: 'f', code: 'KeyF', altKey: true }), at(), 'focusMode'],
    [
      'Alt+F on a non-QWERTY layout',
      key({ key: 'ƒ', code: 'KeyF', altKey: true }),
      at(),
      'focusMode',
    ],
    ['Alt+F while typing', key({ key: 'ƒ', code: 'KeyF', altKey: true }), singleLine, null],
    ['Ctrl+Alt+F', key({ code: 'KeyF', altKey: true, ctrlKey: true }), at(), null],
    ['Alt+K (knowledge base)', key({ key: '˚', code: 'KeyK', altKey: true }), at(), 'knowledge'],
    ['Alt+K while typing', key({ key: '˚', code: 'KeyK', altKey: true }), singleLine, null],
    ['anything during IME composition', key({ key: 'Enter', isComposing: true }), at(), null],
    ['anything inside a dialog', key({ key: 'Enter', ctrlKey: true }), at({ dialog: true }), null],
  ])('%s', (_, event, target, expected) => {
    expect(shortcutIntent(event, target)?.type ?? null).toBe(expected);
  });

  it('maps Alt+1…9 to interaction indexes by physical key', () => {
    expect(shortcutIntent(key({ code: 'Digit1', altKey: true }), at())).toEqual({
      type: 'tab',
      index: 0,
    });
    expect(shortcutIntent(key({ code: 'Digit9', altKey: true }), at())).toEqual({
      type: 'tab',
      index: 8,
    });
    expect(shortcutIntent(key({ code: 'Digit0', altKey: true }), at())).toBeNull();
  });
});

describe('describeTarget', () => {
  it('classifies fields, controls and dialogs', () => {
    document.body.innerHTML = `
      <input id="text" />
      <input id="check" type="checkbox" />
      <textarea id="area"></textarea>
      <div id="combo" role="combobox" tabindex="0"></div>
      <button id="button">Go</button>
      <div role="dialog"><input id="inDialog" /></div>`;
    const get = (id: string) => document.getElementById(id);
    expect(describeTarget(get('text'))).toEqual(at({ typing: true }));
    expect(describeTarget(get('check'))).toEqual(at());
    expect(describeTarget(get('area'))).toEqual(multiLine);
    expect(describeTarget(get('combo'))).toEqual(multiLine);
    expect(describeTarget(get('button'))).toEqual(at({ control: true }));
    expect(describeTarget(get('inDialog')).dialog).toBe(true);
    expect(describeTarget(null)).toEqual(at());
  });
});

describe('page focus', () => {
  it('focuses the first enabled field, else the heading', () => {
    globalThis.document.body.innerHTML = `
      <div id="root"><input disabled /><input type="hidden" /><textarea id="first"></textarea></div>
      <div id="empty"><button>Only a button</button></div>
      <h2 id="heading" tabindex="-1">Title</h2>`;
    const heading = globalThis.document.getElementById('heading');
    expect(pageFocusTarget(globalThis.document.getElementById('root')!, heading)?.id).toBe('first');
    expect(pageFocusTarget(globalThis.document.getElementById('empty')!, heading)).toBe(heading);
  });
});
