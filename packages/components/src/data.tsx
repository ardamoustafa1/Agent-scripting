import { useState } from 'react';
import { z } from 'zod';

import {
  WebService,
  useRuntimePaths,
  RuntimeProblem,
  type RendererProps,
} from '@verbis/core-runtime';
import { JsonValueSchema, type JsonValue } from '@verbis/script-schema';
import { Alert, Combobox, Input, DataTable, Badge } from '@verbis/ui';

import { readPath, display } from './environment.js';
import { DataSchema } from './schemas.js';
import { Frame, CoreAction, useLabels, useField } from './shared.js';

function chartNumber(value: JsonValue | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
const rowsSchema = z.array(z.record(z.string(), JsonValueSchema)).max(5000);
export function DataComponent(component: RendererProps) {
  const p = DataSchema.parse(component.props),
    { text, t } = useLabels(component),
    f = useField(component);
  const [query, setQuery] = useState('');
  useRuntimePaths(component.runtime, [`ds.${p.ds}`, `vars.${p.queryVariable}`]);
  component.runtime.expressions.assertDisplay(`ds.${p.ds}.${p.output}`);
  const state = component.runtime.store.get(`ds.${p.ds}`),
    raw = p.rows ?? readPath(state, p.output);
  const rows = raw === undefined || raw === null ? [] : rowsSchema.parse(raw);
  const value = (
    row: Record<string, JsonValue>,
    field: string,
    format = 'text',
    currency = 'TRY',
  ): string | number => {
    const input = readPath(row, field);
    if (typeof input === 'number' && format === 'currency')
      return new Intl.NumberFormat(component.runtime.store.locale, {
        style: 'currency',
        currency,
      }).format(input);
    if (typeof input === 'number' && format === 'number')
      return new Intl.NumberFormat(component.runtime.store.locale).format(input);
    if (typeof input === 'string' && format === 'date') {
      const date = new Date(input);
      return Number.isFinite(date.getTime())
        ? new Intl.DateTimeFormat(component.runtime.store.locale).format(date)
        : '';
    }
    return display(input);
  };
  let content;
  switch (component.node.type) {
    case 'lookup':
    case 'autoComplete': {
      const options = rows
        .map((row) => ({ value: display(row[p.valueField]), label: display(row[p.labelField]) }))
        .filter((option) => option.value);
      content = (
        <>
          {component.node.type === 'autoComplete' && (
            <Input
              label={text(p.labelKey)}
              disabled={!component.enabled || p.disabled}
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                component.runtime.store.setVariable(p.queryVariable, event.target.value);
              }}
            />
          )}
          <Combobox
            label={text(p.labelKey)}
            disabled={!component.enabled || p.disabled}
            options={options}
            value={typeof f.value === 'string' ? f.value : ''}
            onValueChange={(selected) => {
              f.write(selected);
            }}
          />
        </>
      );
      break;
    }
    case 'dataGrid':
    case 'table':
      content = (
        <DataTable<Record<string, JsonValue>>
          label={text(p.labelKey)}
          data={rows}
          columns={p.columns.map((column) => ({
            id: column.field,
            header: text(column.labelKey),
            accessor: (row) => value(row, column.field, column.format, column.currency),
          }))}
          getRowId={(row) => {
            const id = display(row[p.rowKey]);
            if (!id) throw new RuntimeProblem('VERBIS_DATA_ROW_KEY');
            return id;
          }}
          virtualized
        />
      );
      break;
    case 'timeline':
      content = (
        <ol className="vc-timeline" aria-label={text(p.labelKey)}>
          {rows.map((row, index) => (
            <li key={display(row[p.rowKey]) || index}>
              <time>{display(row['date'])}</time>
              <strong>{display(row[p.labelField])}</strong>
              <p>{display(row['description'])}</p>
            </li>
          ))}
        </ol>
      );
      break;
    case 'chart': {
      const max = Math.max(
        1,
        ...rows.map((row) =>
          typeof row[p.valueField] === 'number' ? Math.abs(chartNumber(row[p.valueField])) : 0,
        ),
      );
      content = (
        <>
          <svg
            role="img"
            aria-labelledby={`${component.node.id}-chart-title`}
            viewBox={`0 0 600 ${Math.max(80, rows.length * 36)}`}
            className="vc-chart"
          >
            <title id={`${component.node.id}-chart-title`}>{text(p.labelKey)}</title>
            {p.chartType === 'line' ? (
              <polyline
                points={rows
                  .map(
                    (row, i) =>
                      `${(i * 600) / Math.max(1, rows.length - 1)},${Math.max(20, rows.length * 36) - (chartNumber(row[p.valueField]) / max) * (Math.max(20, rows.length * 36) - 20)}`,
                  )
                  .join(' ')}
                fill="none"
                stroke="var(--vb-color-primary)"
                strokeWidth="3"
              />
            ) : (
              rows.map((row, i) => (
                <rect
                  key={i}
                  x="0"
                  y={i * 36}
                  height="24"
                  width={(Math.max(0, chartNumber(row[p.valueField])) / max) * 600}
                  fill="var(--vb-color-primary)"
                />
              ))
            )}
          </svg>
          <table className="vc-chart-data">
            <caption>{text(p.labelKey)}</caption>
            <thead>
              <tr>
                <th scope="col">{t('components.category')}</th>
                <th scope="col">{t('components.value')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  <th scope="row">{display(row[p.labelField])}</th>
                  <td>{display(row[p.valueField])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      );
      break;
    }
    default:
      content = (
        <>
          {component.node.type === 'customerCard' && (
            <Badge>{text(p.titleKey ?? p.labelKey)}</Badge>
          )}
          <dl className="vc-key-values">
            {rows.map((row, i) => (
              <div key={display(row[p.rowKey]) || i}>
                {p.columns.map((column) => (
                  <div key={column.field}>
                    <dt>{text(column.labelKey)}</dt>
                    <dd>{value(row, column.field, column.format, column.currency)}</dd>
                  </div>
                ))}
              </div>
            ))}
          </dl>
        </>
      );
  }
  const trigger = component.node.type === 'autoComplete' ? 'onChange' : p.trigger;
  return (
    <Frame component={component} card={component.node.type === 'customerCard'}>
      <WebService
        {...component}
        node={{ ...component.node, id: `${component.node.id}-service` }}
        props={{
          ds: p.ds,
          trigger,
          visible: true,
          debounceMs: p.debounceMs,
          watch: trigger === 'onChange' ? [`vars.${p.queryVariable}`] : [],
          emptyWhen: {
            $expr: `ds.${p.ds}.loading == false && ds.${p.ds}.status == "success" && count(ds.${p.ds}.${p.output}) == 0`,
          },
        }}
      />
      {rows.length ? (
        content
      ) : p.rows !== undefined ||
        (typeof state === 'object' &&
          state !== null &&
          'status' in state &&
          state['status'] === 'success') ? (
        <Alert title={t('components.empty')} />
      ) : null}
      {p.trigger === 'manual' && (
        <CoreAction
          component={component}
          labelKey="components.refresh"
          actions={[{ type: 'callDataSource', dataSource: p.ds }]}
        />
      )}
    </Frame>
  );
}
