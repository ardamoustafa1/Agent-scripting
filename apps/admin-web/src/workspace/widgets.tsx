import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, DataTable, Skeleton } from '@verbis/ui';

import {
  AdminApiError,
  useAdmin,
  useResource,
  ListSchema,
  problemCategory,
  request,
  text,
  type Row,
} from './api.js';
import { ENUM_COLUMNS, type AdminEnum } from './enums.js';

export const useLabels = () => {
  const { t } = useTranslation();
  return (key: string) => t(`adminWorkspace.${key}`);
};
/** Localized label of an enum value; unknown values (newer API) stay readable instead of a key. */
export const useEnumLabel = () => {
  const { t, i18n } = useTranslation();
  return (name: AdminEnum, value: string) => {
    const key = `adminWorkspace.enum.${name}.${value}`;
    return value && i18n.exists(key) ? t(key) : value;
  };
};
/** System roles are stored by key; show their catalog label and description (U-02, U-03). */
export const useRoleText = () => {
  const { t, i18n } = useTranslation();
  const label = (name: string) =>
      i18n.exists(`authz.roles.${name}`) ? t(`authz.roles.${name}`) : name,
    description = (row: Row) => {
      const name = text(row, 'name'),
        stored = text(row, 'description');
      return row['isSystem'] === true && i18n.exists(`authz.roleDescriptions.${name}`)
        ? t(`authz.roleDescriptions.${name}`)
        : stored;
    };
  return { label, description };
};
export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="aw-card">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
export function Field({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
  disabled = false,
  options,
  enumName,
  optionLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  disabled?: boolean;
  options?: readonly string[];
  enumName?: AdminEnum;
  optionLabel?: (value: string) => string;
}) {
  const enumLabel = useEnumLabel(),
    labelOf = (option: string) =>
      optionLabel ? optionLabel(option) : enumName ? enumLabel(enumName, option) : option;
  return (
    <label className="aw-field">
      <span>{label}</span>
      {options ? (
        <select
          disabled={disabled}
          required={required}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {labelOf(option)}
            </option>
          ))}
        </select>
      ) : type === 'textarea' ? (
        <textarea
          disabled={disabled}
          required={required}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      ) : (
        <input
          type={type}
          disabled={disabled}
          required={required}
          autoComplete={type === 'password' ? 'new-password' : 'off'}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      )}
    </label>
  );
}
export function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="aw-check">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
      {label}
    </label>
  );
}
export function JsonView({ value }: { value: unknown }) {
  const l = useLabels();
  return (
    <textarea
      className="aw-json"
      aria-label={l('details')}
      readOnly
      rows={10}
      value={JSON.stringify(value, null, 2)}
    />
  );
}
export function Feedback({ error, success }: { error?: unknown; success?: boolean }) {
  const l = useLabels(),
    { t } = useTranslation();
  const category = error instanceof Error ? problemCategory(error) : null,
    reference = error instanceof AdminApiError ? error.correlationId : undefined;
  return error ? (
    <p role="alert" className="aw-error">
      {l('failed')} · {category ? l(`errors.${category}`) : l('invalid')}
      {reference ? (
        <>
          {' · '}
          <span className="aw-reference">
            {t('adminWorkspace.errors.reference', { id: reference })}
          </span>
        </>
      ) : null}
    </p>
  ) : success ? (
    <p role="status">{l('saved')}</p>
  ) : null;
}
export function Action({
  label,
  run,
  danger = false,
  disabled = false,
}: {
  label: string;
  run: () => Promise<unknown>;
  danger?: boolean;
  disabled?: boolean;
}) {
  const l = useLabels(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [success, setSuccess] = useState(false),
    [confirm, setConfirm] = useState(false);
  const invoke = async () => {
    if (disabled || busy) return;
    setBusy(true);
    setError(undefined);
    setSuccess(false);
    try {
      await run();
      setSuccess(true);
      setConfirm(false);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="aw-action">
      <Button
        disabled={disabled}
        variant={danger ? 'danger' : 'secondary'}
        loading={busy}
        onClick={() => {
          if (danger) setConfirm(true);
          else void invoke();
        }}
      >
        {label}
      </Button>
      {confirm ? (
        <div role="group" aria-label={l('confirm')}>
          <p>{l('confirmHint')}</p>
          <Button variant="danger" disabled={disabled} loading={busy} onClick={() => void invoke()}>
            {l('confirm')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setConfirm(false);
            }}
          >
            {l('cancel')}
          </Button>
        </div>
      ) : null}
      <Feedback error={error} success={success} />
    </div>
  );
}
export function SaveForm({
  children,
  onSave,
  disabled = false,
}: {
  children: ReactNode;
  onSave: () => Promise<unknown>;
  disabled?: boolean;
}) {
  const l = useLabels(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [saved, setSaved] = useState(false);
  return (
    <form
      className="aw-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || disabled) return;
        setBusy(true);
        setError(undefined);
        setSaved(false);
        void Promise.resolve()
          .then(onSave)
          .then(() => {
            setSaved(true);
          })
          .catch(setError)
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      {children}
      <div>
        <Button type="submit" loading={busy} disabled={disabled}>
          {l('save')}
        </Button>
      </div>
      <Feedback error={error} success={saved} />
    </form>
  );
}
export function ResourceList({
  path,
  title,
  columns,
  onSelect,
  poll = false,
  enums = {},
  format = {},
}: {
  path: string;
  title: string;
  columns: readonly string[];
  onSelect?: (row: Row) => void;
  poll?: boolean;
  /** Column → enum overrides for ambiguous columns such as `kind`. */
  enums?: Readonly<Record<string, AdminEnum>>;
  /** Column → display formatter for values that need more than an enum label. */
  format?: Readonly<Record<string, (row: Row) => string>>;
}) {
  const l = useLabels(),
    enumLabel = useEnumLabel(),
    display = (row: Row, key: string) => {
      const formatter = format[key],
        name = enums[key] ?? ENUM_COLUMNS[key];
      return formatter ? formatter(row) : name ? enumLabel(name, text(row, key)) : text(row, key);
    },
    [pagination, setPagination] = useState<{ path: string; cursor: string | null }>({
      path,
      cursor: null,
    });
  const cursor = pagination.path === path ? pagination.cursor : null;
  if (pagination.path !== path) setPagination({ path, cursor: null });
  const separator = path.includes('?') ? '&' : '?';
  const query = useResource(
    `${path}${cursor ? `${separator}cursor=${encodeURIComponent(cursor)}` : ''}`,
    ListSchema,
    poll,
  );
  if (query.isPending) return <Skeleton label={l('loading')} height={160} />;
  if (query.isError)
    return (
      <>
        <Feedback error={query.error} />
        <Button onClick={() => void query.refetch()}>{l('retry')}</Button>
      </>
    );
  return (
    <>
      <DataTable
        label={title}
        data={query.data.data}
        getRowId={(row) => row.id}
        columns={[
          ...columns.map((key) => ({
            id: key,
            header: l(key),
            accessor: (row: Row) => display(row, key),
          })),
          ...(onSelect
            ? [
                {
                  id: 'open',
                  header: l('details'),
                  accessor: (row: Row) => row.id,
                  cell: (row: Row) => (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        onSelect(row);
                      }}
                    >
                      {l('details')}
                    </Button>
                  ),
                },
              ]
            : []),
        ]}
      />
      {!query.data.data.length ? <p>{l('empty')}</p> : null}
      <div className="aw-inline">
        <Button
          variant="ghost"
          disabled={!cursor}
          onClick={() => {
            setPagination({ path, cursor: null });
          }}
        >
          {l('first')}
        </Button>
        <Button
          variant="secondary"
          disabled={!query.data.page?.nextCursor}
          onClick={() => {
            setPagination({ path, cursor: query.data.page?.nextCursor ?? null });
          }}
        >
          {l('next')}
        </Button>
      </div>
    </>
  );
}
/**
 * D-17: typeahead against the server (`?q=`) with keyset "load more", so tenants with more than
 * one page of records are searchable instead of filtering only what was already loaded.
 */
function useSearchList(path: string, labelOf: (row: Row) => string) {
  const session = useAdmin(),
    [term, setTerm] = useState(''),
    [applied, setApplied] = useState(''),
    [cachedNames, setCachedNames] = useState(new Map<string, string>());
  useEffect(() => {
    const timer = setTimeout(() => {
      setApplied(term.trim());
    }, 250);
    return () => {
      clearTimeout(timer);
    };
  }, [term]);
  const join = (url: string, param: string) => `${url}${url.includes('?') ? '&' : '?'}${param}`,
    base = applied ? join(path, `q=${encodeURIComponent(applied)}`) : path,
    query = useInfiniteQuery({
      queryKey: ['admin', session.user.tenantId, session.user.id, base, 'pages'],
      initialPageParam: null as string | null,
      queryFn: ({ pageParam, signal }) =>
        request(
          pageParam ? join(base, `cursor=${encodeURIComponent(pageParam)}`) : base,
          ListSchema,
          {
            signal,
          },
        ),
      getNextPageParam: (last) => last.page?.nextCursor ?? undefined,
      retry: false,
    }),
    rows = query.data?.pages.flatMap((page) => page.data) ?? [];
  const names = new Map(cachedNames);
  for (const row of rows) names.set(row.id, labelOf(row));
  const search = (value: string) => {
    setCachedNames(names);
    setTerm(value);
  };
  return { term, setTerm: search, query, rows, names, searching: applied !== '' };
}
function SearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const l = useLabels();
  return (
    <input
      type="search"
      className="aw-picker-search"
      aria-label={l('pickerSearch')}
      placeholder={l('pickerSearch')}
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    />
  );
}
function LoadMore({
  hasNext,
  loading,
  onClick,
}: {
  hasNext: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  const l = useLabels();
  return hasNext ? (
    <Button variant="ghost" size="sm" disabled={loading} onClick={onClick}>
      {l('pickerLoadMore')}
    </Button>
  ) : null;
}
const rowName = (row: Row, nameKey?: string) =>
  (nameKey ? text(row, nameKey) : '') ||
  text(row, 'displayName') ||
  text(row, 'name') ||
  text(row, 'email') ||
  row.id;
export function Picker({
  path,
  label,
  value,
  onChange,
}: {
  path: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const l = useLabels(),
    list = useSearchList(path, (row) => rowName(row)),
    known = list.rows.some((row) => row.id === value);
  return (
    <div className="aw-picker">
      <SearchBox value={list.term} onChange={list.setTerm} />
      <label className="aw-field">
        <span>{label}</span>
        <select
          required
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        >
          <option value="">{l('choose')}</option>
          {value && !known ? <option value={value}>{list.names.get(value) ?? value}</option> : null}
          {list.rows.map((row) => (
            <option value={row.id} key={row.id}>
              {rowName(row)}
            </option>
          ))}
        </select>
        <Feedback error={list.query.error} />
      </label>
      {list.searching && list.query.isSuccess && !list.rows.length ? (
        <p>{l('pickerNoMatches')}</p>
      ) : null}
      <LoadMore
        hasNext={list.query.hasNextPage}
        loading={list.query.isFetchingNextPage}
        onClick={() => void list.query.fetchNextPage()}
      />
    </div>
  );
}
/** Pick scope ids by name; "all" is the `*` wildcard of an ABAC role scope (U-05). */
export function ScopePicker({
  path,
  label,
  allLabel,
  nameKey,
  value,
  onChange,
}: {
  path: string;
  label: string;
  allLabel: string;
  nameKey: string;
  value: '*' | readonly string[];
  onChange: (value: '*' | string[]) => void;
}) {
  const l = useLabels(),
    list = useSearchList(path, (row) => rowName(row, nameKey)),
    query = list.query,
    all = value === '*',
    selected = all ? [] : value,
    offscreen = selected.filter((id) => !list.rows.some((row) => row.id === id));
  return (
    <fieldset className="aw-scope">
      <legend>{label}</legend>
      <Check
        label={allLabel}
        checked={all}
        onChange={(checked) => {
          onChange(checked ? '*' : []);
        }}
      />
      {all ? null : (
        <div className="aw-permissions">
          <SearchBox value={list.term} onChange={list.setTerm} />
          {offscreen.map((id) => (
            <Check
              key={id}
              label={list.names.get(id) ?? id}
              checked
              onChange={() => {
                onChange(selected.filter((other) => other !== id));
              }}
            />
          ))}
          {list.rows.map((row) => (
            <Check
              key={row.id}
              label={text(row, nameKey) || row.id}
              checked={selected.includes(row.id)}
              onChange={(checked) => {
                onChange(checked ? [...selected, row.id] : selected.filter((id) => id !== row.id));
              }}
            />
          ))}
          {query.isSuccess && !list.rows.length ? (
            <p>{l(list.searching ? 'pickerNoMatches' : 'noScopeOptions')}</p>
          ) : null}
          <LoadMore
            hasNext={query.hasNextPage}
            loading={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          />
        </div>
      )}
      <Feedback error={query.error} />
    </fieldset>
  );
}
export function DiffView({ value }: { value: unknown }) {
  const l = useLabels();
  if (!value || typeof value !== 'object') return <p>{l('empty')}</p>;
  const diff = value as Record<string, unknown>;
  if (diff['mode'] === 'snapshot')
    return (
      <div className="aw-diff">
        <div data-change="remove">
          <h3>{l('before')}</h3>
          <JsonView value={diff['before']} />
        </div>
        <div data-change="add">
          <h3>{l('after')}</h3>
          <JsonView value={diff['after']} />
        </div>
      </div>
    );
  if (diff['mode'] === 'patch' && Array.isArray(diff['ops']))
    return (
      <div className="aw-patches">
        {diff['ops'].map((value: unknown, index: number) => {
          const operation = value as Record<string, unknown>;
          return (
            <div key={index} data-change={String(operation['op'])}>
              <strong>
                {String(operation['op'])} · {String(operation['path'])}
              </strong>
              <JsonView value={operation['value']} />
            </div>
          );
        })}
      </div>
    );
  return <JsonView value={value} />;
}
