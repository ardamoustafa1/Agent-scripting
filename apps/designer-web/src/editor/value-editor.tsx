import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  ExpressionRefSchema,
  JsonValueSchema,
  ValueSchema,
  type JsonValue,
  type Value,
  type VariableType,
} from '@verbis/script-schema';
import { Input, Select, Textarea } from '@verbis/ui';

import { ExpressionEditor } from './expression-lazy.js';

/** What the value is for: a variable type, or `any` when the target accepts every literal. */
export type ValueKind = VariableType | 'any';
export interface ValueChoice {
  readonly value: string;
  readonly label: string;
}
export interface ValueVariable {
  readonly key: string;
  readonly type: VariableType;
}
type Mode = 'fixed' | 'variable' | 'formula';

const VARIABLE_REFERENCE = /^vars\.([a-z][a-zA-Z0-9]*)$/;

/** Source of an expression value; `undefined` for literals. */
export function expressionOf(value: Value): string | undefined {
  const parsed = ExpressionRefSchema.safeParse(value);
  return parsed.success ? parsed.data.$expr : undefined;
}
/** How an existing value was authored: a literal, a single variable reference, or a formula. */
export function valueMode(value: Value): Mode {
  const source = expressionOf(value);
  if (source === undefined) return 'fixed';
  return VARIABLE_REFERENCE.test(source.trim()) ? 'variable' : 'formula';
}
/** Value kind for a variable type; enums are strings with choices, unknown types accept any. */
export function valueKind(type: string | undefined): ValueKind {
  return type === 'number' ||
    type === 'boolean' ||
    type === 'date' ||
    type === 'array' ||
    type === 'object'
    ? type
    : type === 'enum' || type === 'string'
      ? 'string'
      : 'any';
}
/** The empty literal of a kind; the starting point when an author switches to a fixed value. */
export function emptyValue(kind: ValueKind): JsonValue {
  switch (kind) {
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object':
      return {};
    default:
      return '';
  }
}
/** Comma separated text → list of strings; numbers stay numbers so `1, 2` round-trips. */
export function parseList(text: string): JsonValue[] {
  return text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (/^-?\d+(\.\d+)?$/.test(part) ? Number(part) : part));
}

/**
 * Typed value input used wherever a script stores a value (set variable, default value,
 * platform write-back). Authors pick a fixed value with a control that matches the type, another
 * variable, or a formula; JSON is only offered for nested lists and objects.
 */
export function ValueEditor({
  label,
  value,
  onChange,
  kind,
  choices,
  variables,
  allowSources = true,
}: {
  label: string;
  value: Value;
  onChange: (value: Value) => void;
  kind: ValueKind;
  choices?: readonly ValueChoice[] | undefined;
  variables: readonly ValueVariable[];
  allowSources?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const mode = valueMode(value);
  const expression = expressionOf(value) ?? '';
  const literal: JsonValue = mode === 'fixed' ? JsonValueSchema.parse(value) : emptyValue(kind);
  // A literal-only value (e.g. a variable's initial value) is just the typed field.
  if (!allowSources)
    return (
      <FixedValue
        label={label}
        kind={kind}
        value={JsonValueSchema.parse(value)}
        choices={choices}
        onChange={onChange}
      />
    );
  const compatible = variables.filter(
    (variable) => kind === 'any' || variable.type === kind || kind === 'string',
  );
  return (
    <fieldset className="ed-value" aria-labelledby={`${id}-legend`}>
      <legend id={`${id}-legend`}>{label}</legend>
      <Select
        label={t('designer.value.mode')}
        value={mode}
        options={(['fixed', 'variable', 'formula'] as const).map((option) => ({
          value: option,
          label: t(`designer.value.modes.${option}`),
        }))}
        onValueChange={(next) => {
          if (next === mode) return;
          if (next === 'fixed') onChange(emptyValue(kind));
          else if (next === 'variable') {
            const first = compatible[0] ?? variables[0];
            onChange(first ? { $expr: `vars.${first.key}` } : emptyValue(kind));
          } else onChange({ $expr: expression || 'true' });
        }}
      />
      {mode === 'variable' && (
        <Select
          label={t('designer.value.sourceVariable')}
          value={VARIABLE_REFERENCE.exec(expression.trim())?.[1] ?? ''}
          options={variables.map((variable) => ({
            value: variable.key,
            label: variable.key,
            hint: t(`designer.variables.types.${variable.type}`),
          }))}
          onValueChange={(key) => {
            onChange({ $expr: `vars.${key}` });
          }}
        />
      )}
      {mode === 'formula' && (
        <ExpressionEditor
          label={t('designer.value.formula')}
          value={expression}
          variables={variables.map((variable) => variable.key)}
          onChange={(source) => {
            const parsed = ValueSchema.safeParse({ $expr: source });
            if (source.trim() && parsed.success) onChange(parsed.data);
          }}
        />
      )}
      {mode === 'fixed' && (
        <FixedValue
          label={t('designer.value.fixedValue')}
          kind={kind}
          value={literal}
          choices={choices}
          onChange={onChange}
        />
      )}
    </fieldset>
  );
}

function FixedValue({
  label,
  kind,
  value,
  choices,
  onChange,
}: {
  label: string;
  kind: ValueKind;
  value: JsonValue;
  choices?: readonly ValueChoice[] | undefined;
  onChange: (value: JsonValue) => void;
}) {
  const { t } = useTranslation();
  if (choices?.length)
    return (
      <Select
        label={label}
        value={typeof value === 'string' ? value : ''}
        options={choices.map((choice) => ({ value: choice.value, label: choice.label }))}
        onValueChange={onChange}
      />
    );
  switch (kind) {
    case 'boolean':
      return (
        <Select
          label={label}
          value={value === true ? 'true' : 'false'}
          options={[
            { value: 'true', label: t('designer.value.yes') },
            { value: 'false', label: t('designer.value.no') },
          ]}
          onValueChange={(choice) => {
            onChange(choice === 'true');
          }}
        />
      );
    case 'number':
      return (
        <Input
          label={label}
          type="number"
          value={typeof value === 'number' ? String(value) : ''}
          onChange={(event) => {
            const next = event.target.value;
            if (next === '') onChange(null);
            else if (Number.isFinite(Number(next))) onChange(Number(next));
          }}
        />
      );
    case 'date':
      return (
        <Input
          label={label}
          type="date"
          value={typeof value === 'string' ? value.slice(0, 10) : ''}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      );
    case 'array':
      return <ListValue label={label} value={value} onChange={onChange} />;
    case 'object':
      return <JsonValueField label={label} value={value} onChange={onChange} />;
    default:
      return (
        <Input
          label={label}
          value={
            typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
              ? String(value)
              : ''
          }
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      );
  }
}

function ListValue({
  label,
  value,
  onChange,
}: {
  label: string;
  value: JsonValue;
  onChange: (value: JsonValue) => void;
}) {
  const { t } = useTranslation();
  const flat =
    Array.isArray(value) &&
    value.every((item) => typeof item === 'string' || typeof item === 'number');
  const [text, setText] = useState(flat ? value.join(', ') : '');
  if (!flat) return <JsonValueField label={label} value={value} onChange={onChange} />;
  return (
    <Input
      label={label}
      hint={t('designer.value.listHint')}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        onChange(parseList(event.target.value));
      }}
    />
  );
}

/** Nested lists and objects are rare in scripts; they keep a validated JSON field. */
function JsonValueField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: JsonValue;
  onChange: (value: JsonValue) => void;
}) {
  const { t } = useTranslation();
  const [source, setSource] = useState(() => JSON.stringify(value, null, 2)),
    [invalid, setInvalid] = useState(false);
  return (
    <Textarea
      label={`${label} · ${t('designer.value.json')}`}
      value={source}
      {...(invalid
        ? { error: t('designer.editor.jsonInvalid', { example: '{"alan": "değer"}' }) }
        : {})}
      onChange={(event) => {
        setSource(event.target.value);
      }}
      onBlur={() => {
        try {
          onChange(JsonValueSchema.parse(JSON.parse(source) as unknown));
          setInvalid(false);
        } catch {
          setInvalid(true);
        }
      }}
    />
  );
}
