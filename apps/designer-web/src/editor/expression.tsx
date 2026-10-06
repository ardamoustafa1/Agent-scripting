import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { StreamLanguage, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { linter } from '@codemirror/lint';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { useEffect, useRef } from 'react';

import { parseExpression, createDefaultRegistry } from '@verbis/expr';
import { browserNonce } from '@verbis/ui';

const language = StreamLanguage.define({
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match(/^"(?:[^"\\]|\\.)*"|^'(?:[^'\\]|\\.)*'/)) return 'string';
    if (stream.match(/^\d+(\.\d+)?/)) return 'number';
    if (stream.match(/^(true|false|null)\b/)) return 'keyword';
    if (stream.match(/^[a-zA-Z_][\w.]*/)) return 'variableName';
    stream.next();
    return 'operator';
  },
});
export function ExpressionEditor({
  value,
  onChange,
  variables,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  variables: readonly string[];
  label: string;
}) {
  const host = useRef<HTMLDivElement>(null),
    view = useRef<EditorView>();
  const change = useRef(onChange);
  useEffect(() => {
    change.current = onChange;
  }, [onChange]);
  const names = variables.join('|');
  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          EditorView.cspNonce.of(browserNonce()),
          EditorState.readOnly.of(Boolean(host.current.closest('fieldset[disabled]'))),
          EditorView.editable.of(!host.current.closest('fieldset[disabled]')),
          language,
          syntaxHighlighting(defaultHighlightStyle),
          keymap.of(completionKeymap),
          EditorView.contentAttributes.of({ 'aria-label': label }),
          EditorView.theme({
            '&': {
              backgroundColor: 'var(--vb-color-surface-raised)',
              color: 'var(--vb-color-text)',
              fontSize: 'var(--vb-font-size-sm)',
            },
            '.cm-content': { fontFamily: 'var(--vb-font-mono)' },
            '&.cm-focused': { outline: '2px solid var(--vb-color-focus)' },
          }),
          autocompletion({
            override: [
              (context) => {
                const word = context.matchBefore(/[\w.]+/);
                return word
                  ? {
                      from: word.from,
                      options: [
                        ...names
                          .split('|')
                          .filter(Boolean)
                          .map((name) => ({ label: `vars.${name}`, type: 'variable' })),
                        ...createDefaultRegistry()
                          .list()
                          .map((fn) => ({ label: fn.name, type: 'function' })),
                      ],
                    }
                  : null;
              },
            ],
          }),
          linter((view) => {
            const source = view.state.doc.toString();
            if (!source.trim()) return [];
            try {
              parseExpression(source);
              return [];
            } catch {
              return [{ from: 0, to: source.length, severity: 'error', message: label }];
            }
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) change.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = undefined;
    };
    // Initial document is synchronized by the following effect, keeping selection stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names, label]);
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value)
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
  }, [value]);
  return <div className="ed-expression" ref={host} />;
}
