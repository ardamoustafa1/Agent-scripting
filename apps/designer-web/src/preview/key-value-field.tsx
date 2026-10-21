import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { JsonValueSchema, type JsonValue } from '@verbis/script-schema';
import { Button, Input } from '@verbis/ui';

import { JsonField } from '../integrations/json-field.js';

import { isFlatRecord } from './context-paths.js';

const JsonRecordSchema = z.record(z.string(), JsonValueSchema);
/**
 * Test call data as "field / value" rows (customer no, segment…). Values stay text, as CTI
 * attached data does; typed values come from the script's expected fields. Nested data keeps a
 * validated JSON field.
 */
export function KeyValueField({
  label,
  value,
  change,
  keyLabel,
  valueLabel,
  keyError,
  hint,
}: {
  label: string;
  value: JsonValue | undefined;
  change: (value: Record<string, JsonValue>) => void;
  keyLabel?: string;
  valueLabel?: string;
  /** Explains why a field name is not accepted (e.g. a reserved HTTP header). */
  keyError?: (key: string) => string | undefined;
  hint?: string;
}) {
  const { t } = useTranslation();
  const record = value ?? {};
  // Keys being edited are kept locally so a half-typed key never collides with another row.
  const [rows, setRows] = useState(() =>
    isFlatRecord(record) ? Object.entries(record).map(([key, item]) => [key, text(item)]) : null,
  );
  if (!rows)
    return (
      <JsonField
        label={label}
        value={record}
        change={(next) => {
          const parsed = JsonRecordSchema.safeParse(next);
          if (parsed.success) change(parsed.data);
        }}
      />
    );
  const errorOf = (key: string): { error?: string } => {
    const message = key ? keyError?.(key) : undefined;
    return message ? { error: message } : {};
  };
  const commit = (next: string[][]) => {
    setRows(next);
    change(
      Object.fromEntries(
        next
          .filter(([key]) => key?.trim() && !keyError?.(key.trim()))
          .map(([key = '', item = '']) => [key.trim(), item]),
      ),
    );
  };
  return (
    <fieldset className="pv-key-values">
      <legend>{label}</legend>
      {hint && <p className="ed-help">{hint}</p>}
      {rows.length === 0 && <p className="ed-help">{t('designer.preview.noFields')}</p>}
      {rows.map(([key = '', item = ''], index) => (
        <div key={index} className="pv-key-value">
          <Input
            label={keyLabel ?? t('designer.preview.fieldName')}
            value={key}
            {...errorOf(key)}
            onChange={(event) => {
              commit(rows.map((row, i) => (i === index ? [event.target.value, item] : row)));
            }}
          />
          <Input
            label={valueLabel ?? t('designer.preview.fieldValue')}
            value={item}
            onChange={(event) => {
              commit(rows.map((row, i) => (i === index ? [key, event.target.value] : row)));
            }}
          />
          <Button
            size="sm"
            variant="ghost"
            aria-label={t('designer.preview.removeField', { field: key || String(index + 1) })}
            onClick={() => {
              commit(rows.filter((_, i) => i !== index));
            }}
          >
            {t('designer.editor.delete')}
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          setRows([...rows, ['', '']]);
        }}
      >
        {t('designer.preview.addField')}
      </Button>
    </fieldset>
  );
}
function text(value: JsonValue): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : '';
}
