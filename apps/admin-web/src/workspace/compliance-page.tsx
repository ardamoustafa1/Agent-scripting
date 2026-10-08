import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { Alert, Badge, Button, DataTable } from '@verbis/ui';

import { download, request, useAdmin } from './api.js';
import { Action, Card, Check, Feedback, Field, useEnumLabel, useLabels } from './widgets.js';

const Row = z.object({
  scriptId: z.string(),
  scriptName: z.string(),
  versionNumber: z.number(),
  variable: z.string(),
  classification: z.enum(['pii', 'pci']),
  origins: z.string(),
  destinations: z.string(),
  persisted: z.boolean(),
  attention: z.boolean(),
});
const ProcessingRecord = z.object({
  generatedAt: z.string(),
  scripts: z.number(),
  unreadable: z.number(),
  truncated: z.boolean(),
  rows: z.array(Row),
});
type Row = z.infer<typeof Row>;

/** `kind:detail; kind:detail` as written by the API, split into readable parts. */
function parts(value: string): { kind: string; detail: string }[] {
  const seen = new Set<string>(),
    out: { kind: string; detail: string }[] = [];
  for (const raw of value
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)) {
    const at = raw.indexOf(':'),
      kind = at < 0 ? raw : raw.slice(0, at),
      detail = at < 0 ? '' : raw.slice(at + 1);
    // Destinations carry a JSON pointer that is noise for a reader; integrations keep their id.
    const shown =
      kind === 'integration' || kind === 'dataSource' || kind === 'context' ? detail : '';
    const key = `${kind}:${shown}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind, detail: shown });
  }
  return out;
}

export default function Compliance() {
  const l = useLabels(),
    { t, i18n } = useTranslation(),
    enumLabel = useEnumLabel(),
    session = useAdmin(),
    [record, setRecord] = useState<z.infer<typeof ProcessingRecord> | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState<unknown>(),
    [classification, setClassification] = useState('all'),
    [attentionOnly, setAttentionOnly] = useState(false),
    [term, setTerm] = useState('');
  const generate = async () => {
    setLoading(true);
    setError(undefined);
    try {
      setRecord(
        await request('/v1/compliance/processing-record?format=json', ProcessingRecord, {
          csrf: session.csrfToken,
        }),
      );
    } catch (cause) {
      setError(cause);
    } finally {
      setLoading(false);
    }
  };
  const label = (kind: string, group: 'origin' | 'destination') => {
    const key = `adminWorkspace.processing.${group}.${kind}`;
    return i18n.exists(key) ? t(key) : kind;
  };
  const text = (value: string, group: 'origin' | 'destination') =>
    parts(value)
      .map((p) => (p.detail ? `${label(p.kind, group)}: ${p.detail}` : label(p.kind, group)))
      .join(', ') || t('adminWorkspace.processing.noneListed');
  const rows = (record?.rows ?? []).filter(
    (row) =>
      (classification === 'all' || row.classification === classification) &&
      (!attentionOnly || row.attention) &&
      (!term.trim() ||
        `${row.scriptName} ${row.variable}`.toLowerCase().includes(term.trim().toLowerCase())),
  );
  const when = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    );
  return (
    <>
      <Card title={l('processing.title')}>
        <p>{l('processing.intro')}</p>
        <Alert tone="info" title={l('processing.audited')} />
        <Button loading={loading} onClick={() => void generate()}>
          {record ? l('processing.refresh') : l('processing.generate')}
        </Button>
        <Feedback error={error} />
      </Card>
      {record ? (
        <Card title={l('processing.resultTitle')}>
          <p role="status">
            {t('adminWorkspace.processing.summary', {
              date: when(record.generatedAt),
              scripts: record.scripts,
              rows: record.rows.length,
              attention: record.rows.filter((row) => row.attention).length,
            })}
          </p>
          {record.unreadable > 0 ? (
            <Alert
              tone="warning"
              title={t('adminWorkspace.processing.unreadable', { count: record.unreadable })}
            />
          ) : null}
          {record.truncated ? <Alert tone="warning" title={l('processing.truncated')} /> : null}
          <div className="aw-inline">
            <Field
              label={l('processing.classification')}
              value={classification}
              onChange={setClassification}
              options={['all', 'pii', 'pci']}
              optionLabel={(value) =>
                value === 'all' ? l('processing.allClasses') : enumLabel('classification', value)
              }
            />
            <Field label={l('processing.search')} value={term} onChange={setTerm} />
            <Check
              label={l('processing.attentionOnly')}
              checked={attentionOnly}
              onChange={setAttentionOnly}
            />
          </div>
          <p className="aw-hint">{l('processing.attentionHint')}</p>
          {record.rows.length === 0 ? (
            <p>{l('processing.empty')}</p>
          ) : (
            <DataTable
              label={l('processing.title')}
              data={rows}
              getRowId={(row: Row) =>
                `${row.scriptId}-${String(row.versionNumber)}-${row.variable}`
              }
              columns={[
                {
                  id: 'script',
                  header: l('processing.script'),
                  accessor: (row: Row) => `${row.scriptName} v${String(row.versionNumber)}`,
                },
                {
                  id: 'variable',
                  header: l('processing.variable'),
                  accessor: (row: Row) => row.variable,
                },
                {
                  id: 'classification',
                  header: l('processing.classification'),
                  accessor: (row: Row) => row.classification,
                  cell: (row: Row) => (
                    <Badge tone={row.classification === 'pci' ? 'danger' : 'warning'}>
                      {enumLabel('classification', row.classification)}
                    </Badge>
                  ),
                },
                {
                  id: 'origins',
                  header: l('processing.origins'),
                  accessor: (row: Row) => text(row.origins, 'origin'),
                },
                {
                  id: 'destinations',
                  header: l('processing.destinations'),
                  accessor: (row: Row) => text(row.destinations, 'destination'),
                },
                {
                  id: 'persisted',
                  header: l('processing.persisted'),
                  accessor: (row: Row) =>
                    row.persisted ? l('processing.yes') : l('processing.no'),
                },
                {
                  id: 'attention',
                  header: l('processing.attention'),
                  accessor: (row: Row) =>
                    row.attention ? l('processing.yes') : l('processing.no'),
                  cell: (row: Row) =>
                    row.attention ? (
                      <Badge tone="warning">{l('processing.review')}</Badge>
                    ) : (
                      <>{l('processing.ok')}</>
                    ),
                },
              ]}
            />
          )}
          {rows.length === 0 && record.rows.length > 0 ? <p>{l('processing.noMatch')}</p> : null}
          <h3>{l('processing.downloadTitle')}</h3>
          <p>{l('processing.downloadHint')}</p>
          <div className="aw-inline">
            <Action
              label={l('processing.csv')}
              run={() =>
                download(
                  '/v1/compliance/processing-record?format=csv',
                  'verbis-processing-record.csv',
                )
              }
            />
            <Action
              label={l('processing.json')}
              run={() =>
                download(
                  '/v1/compliance/processing-record?format=json',
                  'verbis-processing-record.json',
                )
              }
            />
          </div>
        </Card>
      ) : null}
    </>
  );
}
