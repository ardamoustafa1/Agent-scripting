import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  AttachedDataApiError,
  getMap,
  listEngageConnectors,
  MAPPING_TYPES,
  saveMap,
  validateRows,
  type Mapping,
} from './attached-data-api.js';

const EMPTY: Mapping = { key: '', variable: '', type: 'string', writeBack: false, pii: false };

/** Admin: which Genesys attached-data keys become script variables (and may be written back). */
export function AttachedDataSection({ csrfToken }: { csrfToken: string }) {
  const { t } = useTranslation();
  const id = useId();
  const client = useQueryClient();
  const connectors = useQuery({ queryKey: ['engage-connectors'], queryFn: listEngageConnectors });
  const connectorId = connectors.data?.[0];
  const map = useQuery({
    queryKey: ['engage-map', connectorId],
    queryFn: () => getMap(connectorId ?? ''),
    enabled: connectorId !== undefined,
  });
  const [editedRows, setRows] = useState<Mapping[] | undefined>();
  const rows = editedRows ?? map.data?.attachedData ?? [];
  const [problem, setProblem] = useState<'invalid' | 'duplicate' | undefined>();
  const save = useMutation({
    mutationFn: () =>
      saveMap(
        { connectorId: connectorId ?? '', version: map.data?.version ?? 0, attachedData: rows },
        csrfToken,
      ),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['engage-map', connectorId] });
      setRows(undefined);
    },
  });
  if (connectorId === undefined) return null;

  const update = (index: number, patch: Partial<Mapping>) => {
    setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const verdict = validateRows(rows);
    setProblem(verdict === 'ok' ? undefined : verdict);
    if (verdict === 'ok') save.mutate();
  };
  const errorKey =
    save.error instanceof AttachedDataApiError &&
    save.error.code === 'VERBIS_CONCURRENCY_VERSION_MISMATCH'
      ? 'admin.attachedData.error.stale'
      : 'admin.attachedData.error.generic';

  return (
    <section className="vb-card" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{t('admin.attachedData.title')}</h2>
      <p>{t('admin.attachedData.description')}</p>
      <form className="vb-stack" onSubmit={submit} noValidate>
        <table>
          <caption>{t('admin.attachedData.caption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('admin.attachedData.key')}</th>
              <th scope="col">{t('admin.attachedData.variable')}</th>
              <th scope="col">{t('admin.attachedData.type')}</th>
              <th scope="col">{t('admin.attachedData.writeBack')}</th>
              <th scope="col">{t('admin.attachedData.pii')}</th>
              <th scope="col">{t('admin.attachedData.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                <td>
                  <input
                    className="vb-input"
                    aria-label={t('admin.attachedData.keyFor', { n: index + 1 })}
                    maxLength={128}
                    value={row.key}
                    onChange={(e) => {
                      update(index, { key: e.target.value });
                    }}
                  />
                </td>
                <td>
                  <input
                    className="vb-input"
                    aria-label={t('admin.attachedData.variableFor', { n: index + 1 })}
                    maxLength={64}
                    value={row.variable}
                    onChange={(e) => {
                      update(index, { variable: e.target.value });
                    }}
                  />
                </td>
                <td>
                  <select
                    className="vb-input"
                    aria-label={t('admin.attachedData.typeFor', { n: index + 1 })}
                    value={row.type}
                    onChange={(e) => {
                      update(index, { type: e.target.value as Mapping['type'] });
                    }}
                  >
                    {MAPPING_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {t(`admin.attachedData.types.${type}`)}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={t('admin.attachedData.writeBackFor', { n: index + 1 })}
                    checked={row.writeBack}
                    onChange={(e) => {
                      update(index, { writeBack: e.target.checked });
                    }}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={t('admin.attachedData.piiFor', { n: index + 1 })}
                    checked={row.pii}
                    onChange={(e) => {
                      update(index, { pii: e.target.checked });
                    }}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="vb-button"
                    onClick={() => {
                      setRows(rows.filter((_, i) => i !== index));
                    }}
                  >
                    {t('admin.attachedData.remove')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <p>{t('admin.attachedData.empty')}</p> : null}
        <button
          type="button"
          className="vb-button"
          onClick={() => {
            setRows([...rows, { ...EMPTY }]);
          }}
        >
          {t('admin.attachedData.add')}
        </button>
        <button
          type="submit"
          className="vb-button"
          disabled={save.isPending || map.data === undefined}
        >
          {t('admin.attachedData.save')}
        </button>
        {problem === undefined ? null : (
          <p className="vb-alert" role="alert">
            {t(`admin.attachedData.error.${problem}`)}
          </p>
        )}
        {save.isError ? (
          <p className="vb-alert" role="alert">
            {t(errorKey)}
          </p>
        ) : null}
        {save.isSuccess ? <p role="status">{t('admin.attachedData.saved')}</p> : null}
      </form>
    </section>
  );
}
