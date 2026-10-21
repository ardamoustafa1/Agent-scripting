import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { JsonValueSchema } from '@verbis/script-schema';
import type { IntegrationAuth } from '@verbis/shared-types';
import { Alert, Badge, Button, Checkbox, Input, Select } from '@verbis/ui';

import { ValueEditor, emptyValue } from '../editor/value-editor.js';
import { KeyValueField } from '../preview/key-value-field.js';

import { AuthEditor } from './auth.js';
import { fields } from './importers.js';
import { JsonField } from './json-field.js';
import {
  FIELD_KINDS,
  rowsFromSchema,
  sampleFromSchema,
  schemaFromRows,
  validFieldName,
  type SchemaRow,
} from './schema-fields.js';

/**
 * Form building blocks for the integration editor. Configuration (fields, URLs, profiles) is
 * edited as fields; only real data samples (responses, fallbacks) stay JSON, and every JSON view
 * remains available under "advanced" for experts.
 */

/** Integration input/output fields as rows: name, type, required. */
export function SchemaFieldsEditor({
  label,
  help,
  schema,
  onChange,
}: {
  label: string;
  help: string;
  schema: Record<string, unknown>;
  onChange: (schema: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const external = JSON.stringify(schema);
  const [source, setSource] = useState(external),
    [emitted, setEmitted] = useState(external),
    [rows, setRows] = useState(() => rowsFromSchema(schema));
  // A schema replaced from outside (inferred from a sample, edited as JSON) resets the rows.
  if (external !== source && external !== emitted) {
    setSource(external);
    setRows(rowsFromSchema(schema));
  }
  const commit = (next: SchemaRow[]) => {
    setRows(next);
    const built = schemaFromRows(
      next.filter((row) => validFieldName(row.name)),
      schema,
    );
    setEmitted(JSON.stringify(built));
    onChange(built);
  };
  return (
    <fieldset className="ig-schema">
      <legend>{label}</legend>
      <p className="ed-help">{help}</p>
      {rows === null ? (
        <Alert tone="info" title={t('designer.integrations.forms.advancedSchema')} />
      ) : (
        <>
          {rows.length === 0 && (
            <p className="ed-help">{t('designer.integrations.forms.noFields')}</p>
          )}
          {rows.map((row, index) => (
            <div key={index} className="ig-schema-row">
              <Input
                label={t('designer.integrations.forms.fieldName')}
                hint={t('designer.integrations.forms.fieldNameHint')}
                value={row.name}
                {...(row.name && !validFieldName(row.name)
                  ? { error: t('designer.integrations.forms.fieldNameInvalid') }
                  : {})}
                onChange={(event) => {
                  commit(
                    rows.map((r, i) => (i === index ? { ...r, name: event.target.value } : r)),
                  );
                }}
              />
              <Select
                label={t('designer.integrations.forms.fieldKind')}
                value={row.kind === 'any' ? 'string' : row.kind}
                options={FIELD_KINDS.map((kind) => ({
                  value: kind,
                  label: t(`designer.integrations.forms.kinds.${kind}`),
                }))}
                onValueChange={(kind) => {
                  commit(
                    rows.map((r, i) =>
                      i === index ? { ...r, kind: kind as SchemaRow['kind'] } : r,
                    ),
                  );
                }}
              />
              <Checkbox
                label={t('designer.integrations.forms.required')}
                checked={row.required}
                onCheckedChange={(checked) => {
                  commit(
                    rows.map((r, i) => (i === index ? { ...r, required: checked === true } : r)),
                  );
                }}
              />
              <Button
                size="sm"
                variant="ghost"
                aria-label={t('designer.integrations.forms.removeField', {
                  field: row.name || String(index + 1),
                })}
                onClick={() => {
                  commit(rows.filter((_, i) => i !== index));
                }}
              >
                {t('designer.integrations.remove')}
              </Button>
            </div>
          ))}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setRows([...rows, { name: '', kind: 'string', required: false }]);
            }}
          >
            {t('designer.integrations.forms.addField')}
          </Button>
        </>
      )}
      <details className="pv-advanced" open={rows === null}>
        <summary>{t('designer.integrations.forms.jsonView')}</summary>
        <JsonField
          label={`${label} · JSON Schema`}
          value={schema}
          change={(value) => {
            const parsed = z.record(z.string(), z.unknown()).safeParse(value);
            if (parsed.success) onChange(parsed.data);
          }}
        />
      </details>
    </fieldset>
  );
}

/** A list of URLs (allowed origins…) as one field per entry. */
export function UrlListField({
  label,
  help,
  values,
  onChange,
}: {
  label: string;
  help: string;
  values: readonly string[];
  onChange: (values: string[]) => void;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<string[]>(() => [...values]);
  const valid = (value: string) => z.url().safeParse(value).success;
  const commit = (next: string[]) => {
    setRows(next);
    onChange(next.map((value) => value.trim()).filter(valid));
  };
  return (
    <fieldset className="ig-schema">
      <legend>{label}</legend>
      <p className="ed-help">{help}</p>
      {rows.map((value, index) => (
        <div key={index} className="ig-list-row">
          <Input
            label={`${t('designer.integrations.forms.url')} ${String(index + 1)}`}
            type="url"
            placeholder="https://api.example.com"
            value={value}
            {...(value.trim() && !valid(value.trim())
              ? { error: t('designer.integrations.forms.urlInvalid') }
              : {})}
            onChange={(event) => {
              commit(rows.map((row, i) => (i === index ? event.target.value : row)));
            }}
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              commit(rows.filter((_, i) => i !== index));
            }}
          >
            {t('designer.integrations.remove')}
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          setRows([...rows, '']);
        }}
      >
        {t('designer.integrations.forms.addUrl')}
      </Button>
    </fieldset>
  );
}

/** Real example data (mock or fallback responses): JSON, with a one-click sample from the schema. */
export function SampleDataField({
  label,
  value,
  schema,
  onChange,
}: {
  label: string;
  value: unknown;
  schema: Record<string, unknown>;
  onChange: (value: unknown) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="ig-sample">
      <JsonField label={label} value={value} change={onChange} />
      <Button
        size="sm"
        variant="secondary"
        disabled={Object.keys(schema).length === 0}
        onClick={() => {
          onChange(sampleFromSchema(schema));
        }}
      >
        {t('designer.integrations.forms.sampleFromSchema')}
      </Button>
    </div>
  );
}

/** Text, number or boolean fields of a request body; nested bodies use the JSON view. */
export function BodyField({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const { t } = useTranslation();
  const flat =
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => item === null || typeof item !== 'object');
  const [mode, setMode] = useState<'none' | 'form' | 'json'>(
    value === undefined ? 'none' : flat ? 'form' : 'json',
  );
  return (
    <fieldset className="ig-schema">
      <legend>{t('designer.integrations.body')}</legend>
      <Select
        label={t('designer.integrations.forms.bodyMode')}
        value={mode}
        options={(['none', 'form', 'json'] as const).map((option) => ({
          value: option,
          label: t(`designer.integrations.forms.bodyModes.${option}`),
        }))}
        onValueChange={(next) => {
          const chosen = next as typeof mode;
          setMode(chosen);
          if (chosen === 'none') onChange(undefined);
          else if (chosen === 'form' && !flat) onChange({});
        }}
      />
      {mode === 'form' && (
        <KeyValueField
          label={t('designer.integrations.forms.bodyFields')}
          hint={t('designer.integrations.templateHelp')}
          keyLabel={t('designer.integrations.forms.bodyField')}
          valueLabel={t('designer.integrations.forms.bodyValue')}
          value={flat ? (value as Record<string, string>) : {}}
          change={onChange}
        />
      )}
      {mode === 'json' && (
        <JsonField label={t('designer.integrations.body')} value={value ?? {}} change={onChange} />
      )}
    </fieldset>
  );
}

/** One environment profile: base URL and authentication, never raw JSON. */
export function ProfileFields({
  value,
  onChange,
}: {
  value: { baseUrl: string; auth: IntegrationAuth };
  onChange: (value: { baseUrl: string; auth: IntegrationAuth }) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Input
        label={t('designer.integrations.baseUrl')}
        placeholder="https://api.example.com"
        value={value.baseUrl}
        onChange={(event) => {
          onChange({ ...value, baseUrl: event.target.value });
        }}
      />
      <AuthEditor
        value={value.auth}
        change={(auth) => {
          onChange({ ...value, auth });
        }}
      />
    </>
  );
}

/** Profile summary for the approver: what changes, without JSON. */
export function ProfileSummary({
  value,
}: {
  value: { baseUrl: string; auth: IntegrationAuth } | undefined;
}) {
  const { t } = useTranslation();
  if (!value) return null;
  return (
    <dl className="ig-summary">
      <dt>{t('designer.integrations.baseUrl')}</dt>
      <dd>{value.baseUrl}</dd>
      <dt>{t('designer.integrations.forms.authType')}</dt>
      <dd>
        {t(`designer.integrations.authTypes.${value.auth.type}`, { defaultValue: value.auth.type })}
      </dd>
      {'secretRef' in value.auth && (
        <>
          <dt>{t('designer.integrations.forms.secret')}</dt>
          <dd>{t('designer.integrations.forms.secretStored')}</dd>
        </>
      )}
    </dl>
  );
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
function display(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${String(value.length)}]`;
  return '{…}';
}
function pick(source: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((value, part) => (isRecord(value) ? value[part] : undefined), source);
}

/** A test call as a readable summary: outcome, request line, fields handed to scripts. */
export function TraceView({
  trace,
}: {
  trace: {
    request: unknown;
    response: unknown;
    mapped: unknown;
    durationMs: number;
    cached: boolean;
    mock: boolean;
    error: string | null;
  };
}) {
  const { t } = useTranslation();
  const request = isRecord(trace.request) ? trace.request : {};
  const method = typeof request['method'] === 'string' ? request['method'] : undefined;
  const url = typeof request['url'] === 'string' ? request['url'] : undefined;
  const mappedFields = fields(trace.mapped);
  return (
    <div className="ig-trace">
      <p className="ig-trace-head">
        <Badge tone={trace.error ? 'danger' : 'success'}>
          {trace.error
            ? t('designer.integrations.forms.failed')
            : t('designer.integrations.success')}
        </Badge>{' '}
        {t(trace.mock ? 'designer.integrations.mock' : 'designer.integrations.live')}
        {trace.cached ? ` · ${t('designer.integrations.forms.cached')}` : ''}
      </p>
      {trace.error && <Alert tone="danger" title={trace.error} />}
      {method && url && (
        <p>
          <strong>{t('designer.integrations.forms.request')}</strong> {method} {url}
        </p>
      )}
      {mappedFields.length > 0 && (
        <table className="ig-trace-table">
          <caption>{t('designer.integrations.forms.mappedFields')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('designer.integrations.forms.field')}</th>
              <th scope="col">{t('designer.integrations.forms.value')}</th>
            </tr>
          </thead>
          <tbody>
            {mappedFields.map((path) => (
              <tr key={path}>
                <td>{path}</td>
                <td>{display(pick(trace.mapped, path))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <details>
        <summary>{t('designer.integrations.forms.responseData')}</summary>
        <pre className="ig-code">{JSON.stringify(trace.response, null, 2)}</pre>
      </details>
      <details>
        <summary>{t('designer.integrations.forms.rawTrace')}</summary>
        <pre className="ig-code">{JSON.stringify(trace, null, 2)}</pre>
      </details>
    </div>
  );
}

function setPath(source: Record<string, unknown>, path: string, value: unknown) {
  const next = structuredClone(source);
  const parts = path.split('.');
  let node: Record<string, unknown> = next;
  for (const part of parts.slice(0, -1)) {
    const child = node[part];
    if (!isRecord(child)) node[part] = {};
    node = node[part] as Record<string, unknown>;
  }
  const last = parts.at(-1);
  if (last) node[last] = value;
  return next;
}

/** The console's test input as typed fields from the input schema; JSON stays one click away. */
export function TestInputFields({
  schema,
  value,
  onChange,
}: {
  schema: Record<string, unknown>;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const { t } = useTranslation();
  const rows = rowsFromSchema(schema);
  const record = isRecord(value) ? value : {};
  return (
    <fieldset className="ig-schema">
      <legend>{t('designer.integrations.testInput')}</legend>
      {rows?.length ? (
        rows.map((row) => {
          const kind = row.kind === 'integer' ? 'number' : row.kind;
          const current = pick(record, row.name);
          return (
            <ValueEditor
              key={row.name}
              label={
                row.required ? t('designer.sources.requiredInput', { name: row.name }) : row.name
              }
              value={current === undefined ? emptyValue(kind) : JsonValueSchema.parse(current)}
              kind={kind}
              variables={[]}
              allowSources={false}
              onChange={(next) => {
                onChange(setPath(record, row.name, next));
              }}
            />
          );
        })
      ) : (
        <p className="ed-help">{t('designer.integrations.forms.noInputFields')}</p>
      )}
      <details className="pv-advanced" open={!rows?.length}>
        <summary>{t('designer.integrations.forms.jsonView')}</summary>
        <JsonField
          label={t('designer.integrations.forms.testInputJson')}
          value={value}
          change={onChange}
        />
      </details>
    </fieldset>
  );
}
