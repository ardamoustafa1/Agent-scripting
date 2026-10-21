import { ArrowDown, ArrowUp } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { JsonValueSchema, findNode, type Node, type ScriptDocument } from '@verbis/script-schema';
import { Button, Checkbox, Input, Select, Textarea } from '@verbis/ui';

import { applyParamsSync } from './text-variables.js';
import { VariableTextField } from './variable-text-field.js';

import type { EditorStore } from './store.js';

/**
 * Structured component properties edited as rows instead of JSON: rich text blocks, data grid
 * columns and a button's confirmation dialog. Every edit is one undoable document change and the
 * generated i18n keys stay out of sight.
 */
const LOCALES = ['tr', 'en'] as const;
type Messages = ScriptDocument['i18n']['messages'];

function edit(
  store: EditorStore,
  nodeId: string,
  work: (document: ScriptDocument, node: Node) => void,
) {
  store.execute(() => {
    store.edit((d) => {
      const current = findNode(d, nodeId)?.node;
      if (current) work(d, current);
    });
  });
}
function setMessage(document: ScriptDocument, key: string, locale: string, text: string) {
  document.i18n.messages[locale] ??= {};
  const catalog = document.i18n.messages[locale];
  catalog[key] = text;
}
function dropMessages(document: ScriptDocument, keys: readonly string[]) {
  for (const catalog of Object.values(document.i18n.messages))
    for (const key of keys) Reflect.deleteProperty(catalog, key);
}
function freshKey(base: string, taken: readonly string[]) {
  let n = taken.length + 1;
  while (taken.includes(`${base}${String(n)}`)) n++;
  return `${base}${String(n)}`;
}
function RowControls({
  index,
  count,
  copy,
  move,
  remove,
}: {
  index: number;
  count: number;
  copy: string;
  move: (index: number, delta: number) => void;
  remove: (index: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="ed-option-actions">
      <Button
        size="sm"
        variant="ghost"
        disabled={index === 0}
        aria-label={t(`${copy}.moveUp`)}
        onClick={() => {
          move(index, -1);
        }}
      >
        <ArrowUp size={14} aria-hidden />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={index === count - 1}
        aria-label={t(`${copy}.moveDown`)}
        onClick={() => {
          move(index, 1);
        }}
      >
        <ArrowDown size={14} aria-hidden />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          remove(index);
        }}
      >
        {t(`${copy}.remove`)}
      </Button>
    </div>
  );
}
function reorder<T>(rows: readonly T[], index: number, delta: number): T[] {
  const next = [...rows],
    [row] = next.splice(index, 1);
  if (row !== undefined) next.splice(index + delta, 0, row);
  return next;
}

export interface BlockRow {
  tag: 'p' | 'h3' | 'li' | 'strong' | 'em' | 'mark';
  textKey: string;
}
const TAGS: readonly BlockRow['tag'][] = ['p', 'h3', 'li', 'strong', 'em', 'mark'];
export function isBlockRows(value: unknown): value is BlockRow[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item: unknown) =>
        item !== null &&
        typeof item === 'object' &&
        typeof Reflect.get(item, 'textKey') === 'string' &&
        TAGS.includes(Reflect.get(item, 'tag') as BlockRow['tag']),
    )
  );
}

/** Rich text as paragraph/heading/bullet rows with TR/EN text and variable insertion. */
export function BlocksField({
  store,
  node,
  rows,
  messages,
  variables,
  bindableParams,
}: {
  store: EditorStore;
  node: Node;
  rows: readonly BlockRow[];
  messages: Messages;
  variables: readonly string[];
  bindableParams: boolean;
}) {
  const { t } = useTranslation();
  const copy = 'designer.editor.blocks';
  const base = `editor.${node.id.replace(/[^a-zA-Z0-9]+/g, '.')}.blocks.b`;
  const write = (next: BlockRow[], dropped: readonly string[] = []) => {
    edit(store, node.id, (d, current) => {
      current.props['blocks'] = JsonValueSchema.parse(next);
      dropMessages(d, dropped);
      applyParamsSync(d, current, bindableParams);
    });
  };
  return (
    <fieldset className="ed-options">
      <legend>{t(`${copy}.title`)}</legend>
      <p className="ed-help">{t(`${copy}.hint`)}</p>
      {rows.length === 0 && <p className="ed-help">{t(`${copy}.empty`)}</p>}
      {rows.map((row, index) => (
        <fieldset key={row.textKey} className="ed-option-row" aria-label={`#${String(index + 1)}`}>
          <Select
            label={t(`${copy}.format`)}
            value={row.tag}
            options={TAGS.map((tag) => ({ value: tag, label: t(`${copy}.tags.${tag}`) }))}
            onValueChange={(tag) => {
              write(rows.map((r, i) => (i === index ? { ...r, tag: tag as BlockRow['tag'] } : r)));
            }}
          />
          {LOCALES.map((locale) => (
            <VariableTextField
              key={locale}
              label={`${t(`${copy}.text`)} ${String(index + 1)} · ${locale.toUpperCase()}`}
              value={messages[locale]?.[row.textKey] ?? ''}
              variables={bindableParams ? variables : []}
              rows={2}
              onChange={(text) => {
                edit(store, node.id, (d, current) => {
                  setMessage(d, row.textKey, locale, text);
                  applyParamsSync(d, current, bindableParams);
                });
              }}
            />
          ))}
          <RowControls
            index={index}
            count={rows.length}
            copy={copy}
            move={(i, delta) => {
              write(reorder(rows, i, delta));
            }}
            remove={(i) => {
              write(
                rows.filter((_, other) => other !== i),
                [row.textKey],
              );
            }}
          />
        </fieldset>
      ))}
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          write([
            ...rows,
            {
              tag: 'p',
              textKey: freshKey(
                base,
                rows.map((r) => r.textKey),
              ),
            },
          ]);
        }}
      >
        {t(`${copy}.add`)}
      </Button>
    </fieldset>
  );
}

export interface ColumnRow {
  field: string;
  labelKey: string;
  format: 'text' | 'number' | 'date' | 'currency';
  currency: string;
}
const FORMATS: readonly ColumnRow['format'][] = ['text', 'number', 'date', 'currency'];
const FIELD = /^[a-zA-Z][a-zA-Z0-9_.]*$/;
export function isColumnRows(value: unknown): value is ColumnRow[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item: unknown) =>
        item !== null &&
        typeof item === 'object' &&
        typeof Reflect.get(item, 'field') === 'string' &&
        typeof Reflect.get(item, 'labelKey') === 'string',
    )
  );
}

/** Data grid columns: response field, TR/EN title, display format and currency. */
export function ColumnsField({
  store,
  node,
  rows,
  messages,
}: {
  store: EditorStore;
  node: Node;
  rows: readonly ColumnRow[];
  messages: Messages;
}) {
  const { t } = useTranslation();
  const copy = 'designer.editor.gridColumns';
  const base = `editor.${node.id.replace(/[^a-zA-Z0-9]+/g, '.')}.columns.c`;
  const [invalid, setInvalid] = useState<number | null>(null);
  const write = (next: readonly ColumnRow[], dropped: readonly string[] = []) => {
    edit(store, node.id, (d, current) => {
      current.props['columns'] = JsonValueSchema.parse(next);
      dropMessages(d, dropped);
    });
  };
  return (
    <fieldset className="ed-options">
      <legend>{t(`${copy}.title`)}</legend>
      <p className="ed-help">{t(`${copy}.hint`)}</p>
      {rows.length === 0 && <p className="ed-help">{t(`${copy}.empty`)}</p>}
      {rows.map((row, index) => (
        <fieldset key={row.labelKey} className="ed-option-row" aria-label={`#${String(index + 1)}`}>
          <Input
            label={t(`${copy}.field`)}
            hint={t(`${copy}.fieldHint`)}
            defaultValue={row.field}
            {...(invalid === index ? { error: t(`${copy}.invalid`) } : {})}
            onChange={(event) => {
              const field = event.target.value.trim();
              if (!FIELD.test(field)) {
                setInvalid(index);
                return;
              }
              setInvalid(null);
              write(rows.map((r, i) => (i === index ? { ...r, field } : r)));
            }}
          />
          {LOCALES.map((locale) => (
            <Input
              key={locale}
              label={`${t(`${copy}.label`)} · ${locale.toUpperCase()}`}
              value={messages[locale]?.[row.labelKey] ?? ''}
              onChange={(event) => {
                const text = event.target.value;
                edit(store, node.id, (d) => {
                  setMessage(d, row.labelKey, locale, text);
                });
              }}
            />
          ))}
          <Select
            label={t(`${copy}.format`)}
            value={row.format}
            options={FORMATS.map((format) => ({
              value: format,
              label: t(`${copy}.formats.${format}`),
            }))}
            onValueChange={(format) => {
              write(
                rows.map((r, i) =>
                  i === index ? { ...r, format: format as ColumnRow['format'] } : r,
                ),
              );
            }}
          />
          {row.format === 'currency' && (
            <Select
              label={t(`${copy}.currency`)}
              value={row.currency}
              options={['TRY', 'USD', 'EUR', 'GBP'].map((code) => ({
                value: code,
                label: t(`designer.editor.choices.${code}`),
              }))}
              onValueChange={(currency) => {
                write(rows.map((r, i) => (i === index ? { ...r, currency } : r)));
              }}
            />
          )}
          <RowControls
            index={index}
            count={rows.length}
            copy={copy}
            move={(i, delta) => {
              write(reorder(rows, i, delta));
            }}
            remove={(i) => {
              setInvalid(null);
              write(
                rows.filter((_, other) => other !== i),
                [row.labelKey],
              );
            }}
          />
        </fieldset>
      ))}
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          const labelKey = freshKey(
            base,
            rows.map((r) => r.labelKey),
          );
          write([
            ...rows,
            {
              field: `field${String(rows.length + 1)}`,
              labelKey,
              format: 'text',
              currency: 'TRY',
            },
          ]);
        }}
      >
        {t(`${copy}.add`)}
      </Button>
    </fieldset>
  );
}

/** A button's confirmation dialog: one switch plus TR/EN title and text. */
export function ConfirmField({
  store,
  node,
  messages,
}: {
  store: EditorStore;
  node: Node;
  messages: Messages;
}) {
  const { t } = useTranslation();
  const copy = 'designer.editor.confirmField';
  const confirm = node.props['confirm'];
  const keys =
    confirm !== null && typeof confirm === 'object' && !Array.isArray(confirm)
      ? {
          title: typeof confirm['titleKey'] === 'string' ? confirm['titleKey'] : undefined,
          description:
            typeof confirm['descriptionKey'] === 'string' ? confirm['descriptionKey'] : undefined,
        }
      : undefined;
  const base = `editor.${node.id.replace(/[^a-zA-Z0-9]+/g, '.')}.confirm`;
  return (
    <fieldset className="ed-options">
      <Checkbox
        label={t(`${copy}.enable`)}
        checked={!!keys}
        onCheckedChange={(checked) => {
          edit(store, node.id, (d, current) => {
            if (checked === true)
              current.props['confirm'] = {
                titleKey: `${base}.title`,
                descriptionKey: `${base}.description`,
              };
            else {
              Reflect.deleteProperty(current.props, 'confirm');
              dropMessages(d, [`${base}.title`, `${base}.description`]);
            }
          });
        }}
      />
      {keys &&
        (['title', 'description'] as const).map((part) => {
          const key = keys[part];
          return key
            ? LOCALES.map((locale) => (
                <Textarea
                  key={`${part}.${locale}`}
                  label={`${t(`${copy}.${part}`)} · ${locale.toUpperCase()}`}
                  rows={part === 'title' ? 1 : 2}
                  value={messages[locale]?.[key] ?? ''}
                  onChange={(event) => {
                    const text = event.target.value;
                    edit(store, node.id, (d) => {
                      setMessage(d, key, locale, text);
                    });
                  }}
                />
              ))
            : null;
        })}
    </fieldset>
  );
}
