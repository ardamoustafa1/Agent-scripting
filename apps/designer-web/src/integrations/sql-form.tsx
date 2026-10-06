import { useTranslation } from 'react-i18next';

import { Alert, Button, Input } from '@verbis/ui';

import {
  MAX_SQL_PARAMETERS,
  sqlDefinitionPatch,
  validateSql,
  type SqlErrorKey,
  type SqlForm,
} from './sql-model.js';

/** Named read-only SQL: key + ordered input paths only. No SQL text, no credentials. */
export function SqlEditor({
  value,
  change,
}: {
  value: SqlForm;
  change: (value: SqlForm, patch: ReturnType<typeof sqlDefinitionPatch>) => void;
}) {
  const { t } = useTranslation();
  const errors = validateSql(value);
  const message = (key: SqlErrorKey) => {
    const code = errors[key];
    return code ? t(`designer.integrations.sql.error.${code}`) : undefined;
  };
  const fieldError = (text: string, key: SqlErrorKey) => {
    const error = text ? message(key) : undefined;
    return error === undefined ? {} : { error };
  };
  const set = (next: SqlForm) => {
    change(next, sqlDefinitionPatch(next));
  };
  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= value.parameters.length) return;
    const parameters = [...value.parameters];
    const [item] = parameters.splice(index, 1);
    if (item === undefined) return;
    parameters.splice(target, 0, item);
    set({ ...value, parameters });
  };
  return (
    <>
      <Alert tone="info" title={t('designer.integrations.sql.catalogNotice')} />
      <Input
        label={t('designer.integrations.sql.clientId')}
        hint={t('designer.integrations.sql.clientIdHint')}
        value={value.clientId}
        autoComplete="off"
        spellCheck={false}
        {...fieldError(value.clientId, 'clientId')}
        onChange={(e) => {
          set({ ...value, clientId: e.target.value.trim() });
        }}
      />
      <Input
        label={t('designer.integrations.sql.target')}
        hint={t('designer.integrations.sql.targetHint')}
        value={value.target}
        autoComplete="off"
        spellCheck={false}
        {...fieldError(value.target, 'target')}
        onChange={(e) => {
          set({ ...value, target: e.target.value.trim() });
        }}
      />
      <Input
        label={t('designer.integrations.sql.queryKey')}
        hint={t('designer.integrations.sql.queryKeyHint')}
        value={value.queryKey}
        autoComplete="off"
        spellCheck={false}
        {...fieldError(value.queryKey, 'queryKey')}
        onChange={(e) => {
          set({ ...value, queryKey: e.target.value.trim() });
        }}
      />
      <fieldset className="ig-card">
        <legend>{t('designer.integrations.sql.parameters')}</legend>
        <p>{t('designer.integrations.sql.parametersHelp')}</p>
        {value.parameters.map((path, index) => (
          <div key={index} className="ig-sql-param">
            <Input
              label={t('designer.integrations.sql.parameterPath', { position: index + 1 })}
              value={path}
              autoComplete="off"
              spellCheck={false}
              {...fieldError(path, `parameter-${index}`)}
              onChange={(e) => {
                set({
                  ...value,
                  parameters: value.parameters.map((p, i) => (i === index ? e.target.value : p)),
                });
              }}
            />
            <Button
              variant="ghost"
              disabled={index === 0}
              aria-label={t('designer.integrations.sql.moveUp', { position: index + 1 })}
              onClick={() => {
                move(index, -1);
              }}
            >
              {t('designer.integrations.sql.up')}
            </Button>
            <Button
              variant="ghost"
              disabled={index === value.parameters.length - 1}
              aria-label={t('designer.integrations.sql.moveDown', { position: index + 1 })}
              onClick={() => {
                move(index, 1);
              }}
            >
              {t('designer.integrations.sql.down')}
            </Button>
            <Button
              variant="ghost"
              aria-label={t('designer.integrations.sql.removeParameter', { position: index + 1 })}
              onClick={() => {
                set({ ...value, parameters: value.parameters.filter((_, i) => i !== index) });
              }}
            >
              {t('designer.integrations.remove')}
            </Button>
          </div>
        ))}
        <Button
          disabled={value.parameters.length >= MAX_SQL_PARAMETERS}
          onClick={() => {
            set({ ...value, parameters: [...value.parameters, ''] });
          }}
        >
          {t('designer.integrations.sql.addParameter')}
        </Button>
        {errors.parameters && (
          <Alert tone="danger" title={t('designer.integrations.sql.error.tooMany')} />
        )}
      </fieldset>
    </>
  );
}
