import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, DataTable, Skeleton } from '@verbis/ui';

import { useResource, ListSchema, text, type Row } from './api.js';

export const useLabels = () => {
  const { t } = useTranslation();
  return (key: string) => t(`adminWorkspace.${key}`);
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  disabled?: boolean;
  options?: readonly string[];
}) {
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
              {option}
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
  const l = useLabels();
  return error ? (
    <p role="alert" className="aw-error">
      {l('failed')} · {error instanceof Error ? error.message : l('invalid')}
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
}: {
  path: string;
  title: string;
  columns: readonly string[];
  onSelect?: (row: Row) => void;
  poll?: boolean;
}) {
  const l = useLabels(),
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
            accessor: (row: Row) => text(row, key),
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
    query = useResource(path, ListSchema);
  return (
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
        {query.data?.data.map((row) => (
          <option value={row.id} key={row.id}>
            {text(row, 'displayName') || text(row, 'name') || text(row, 'email') || row.id}
          </option>
        ))}
      </select>
      <Feedback error={query.error} />
    </label>
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
