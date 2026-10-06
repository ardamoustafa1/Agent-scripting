import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  VariableSchema,
  literalMatchesType,
  VariableTypeSchema,
  VariableScopeSchema,
  ClassificationSchema,
  JsonValueSchema,
  type Variable,
} from '@verbis/script-schema';
import { Button, Input, Textarea, Select, DataTable, Dialog, Alert } from '@verbis/ui';

import { useEditor, type EditorStore } from '../editor/store.js';

import { jsonDefault, renameVariable, variableUses } from './variables.js';

function VariableForm({
  variable,
  store,
  close,
}: {
  variable: Variable;
  store: EditorStore;
  close: () => void;
}) {
  const { t } = useTranslation();
  const [key, setKey] = useState(variable.key),
    [value, setValue] = useState(variable),
    [source, setSource] = useState(JSON.stringify(variable.default ?? null)),
    [error, setError] = useState(false);
  const uses = variableUses(store.getSnapshot().document, variable.key);
  return (
    <>
      <Input
        label={t('designer.variables.name')}
        value={key}
        onChange={(e) => {
          setKey(e.target.value);
        }}
      />
      <Select
        label={t('designer.workspace.kind')}
        value={value.type}
        options={VariableTypeSchema.options.map((value) => ({ value, label: value }))}
        onValueChange={(type) => {
          const next = VariableTypeSchema.parse(type);
          setValue({
            ...value,
            type: next,
            ...(next === 'enum' ? { enumValues: ['option'] } : {}),
          });
          setSource(JSON.stringify(jsonDefault(next)));
        }}
      />
      <Select
        label={t('designer.workspace.scope')}
        value={value.scope}
        options={VariableScopeSchema.options.map((value) => ({ value, label: value }))}
        onValueChange={(scope) => {
          setValue({ ...value, scope: VariableScopeSchema.parse(scope) });
        }}
      />
      <Select
        label={t('designer.workspace.classification')}
        value={value.classification}
        options={ClassificationSchema.options.map((value) => ({ value, label: value }))}
        onValueChange={(classification) => {
          const next = ClassificationSchema.parse(classification);
          setValue({
            ...value,
            classification: next,
            pii: next === 'pii' || next === 'pci',
            persist: next === 'pci' ? false : value.persist,
          });
        }}
      />
      <label>
        <input
          type="checkbox"
          checked={value.pii}
          onChange={(e) => {
            setValue({
              ...value,
              pii: e.target.checked,
              classification:
                e.target.checked &&
                (value.classification === 'public' || value.classification === 'internal')
                  ? 'pii'
                  : !e.target.checked && value.classification === 'pii'
                    ? 'internal'
                    : value.classification,
            });
          }}
        />
        {t('designer.variables.pii')}
      </label>
      <Textarea
        label={t('designer.variables.default')}
        value={source}
        onChange={(e) => {
          setSource(e.target.value);
        }}
      />
      {value.type === 'enum' && (
        <Input
          label={t('designer.variables.enum')}
          value={value.enumValues?.join(',') ?? ''}
          onChange={(e) => {
            setValue({ ...value, enumValues: e.target.value.split(',').map((v) => v.trim()) });
          }}
        />
      )}
      <details>
        <summary>{t('designer.variables.uses', { count: uses.length })}</summary>
        {uses.map((u) => (
          <code key={u.path}>
            {u.kind}: {u.path}
          </code>
        ))}
      </details>
      {error && <Alert title={t('designer.variables.renameFailed')} tone="danger" />}
      <Button
        onClick={() => {
          try {
            const parsed = VariableSchema.parse({
              ...value,
              key,
              default: JsonValueSchema.parse(JSON.parse(source) as unknown),
            });
            if (!literalMatchesType(parsed, parsed.default ?? null))
              throw new Error('VERBIS_VARIABLE_DEFAULT');
            const original = store.getSnapshot().document;
            if (
              [...store.readonlyPages].some((pageId) => {
                const page = original.pages.find((p) => p.id === pageId);
                return (
                  page &&
                  uses.some((u) => u.path.startsWith(`/pages/${original.pages.indexOf(page)}/`))
                );
              })
            )
              throw new Error('VERBIS_LINKED_VARIABLE');
            const renamed = renameVariable(original, variable.key, key);
            store.edit((d) => {
              Object.assign(d, renamed);
              const index = d.variables.findIndex((v) => v.key === key);
              d.variables[index] = parsed;
            });
            close();
          } catch {
            setError(true);
          }
        }}
      >
        {t('designer.editor.apply')}
      </Button>
    </>
  );
}
export function VariableManager({
  store,
  readOnly = false,
}: {
  store: EditorStore;
  readOnly?: boolean;
}) {
  const state = useEditor(store),
    { t } = useTranslation();
  const [selected, setSelected] = useState<string | null>(null);
  const variable = state.document.variables.find((v) => v.key === selected);
  return (
    <section className="fd-manager">
      <h2>{t('designer.variables.title')}</h2>
      <Button
        disabled={readOnly}
        onClick={() => {
          store.execute(() => {
            let index = 1;
            while (state.document.variables.some((v) => v.key === `variable${index}`)) index++;
            const key = `variable${index}`;
            store.edit((d) => {
              d.variables.push(
                VariableSchema.parse({ key, type: 'string', scope: 'session', default: '' }),
              );
            });
            setSelected(key);
          });
        }}
      >
        {t('designer.variables.add')}
      </Button>
      <DataTable
        label={t('designer.variables.title')}
        data={state.document.variables}
        getRowId={(v) => v.key}
        columns={[
          {
            id: 'key',
            header: t('designer.variables.name'),
            accessor: (v) => v.key,
            cell: (v) => (
              <Button
                disabled={readOnly}
                variant="ghost"
                onClick={() => {
                  setSelected(v.key);
                }}
              >
                {v.key}
              </Button>
            ),
          },
          { id: 'type', header: t('designer.workspace.kind'), accessor: (v) => v.type },
          { id: 'scope', header: t('designer.workspace.scope'), accessor: (v) => v.scope },
          {
            id: 'pii',
            header: t('designer.workspace.classification'),
            accessor: (v) => v.classification,
          },
          {
            id: 'default',
            header: t('designer.variables.default'),
            accessor: (v) =>
              v.pii || v.classification === 'pci' ? '••••' : JSON.stringify(v.default ?? null),
          },
          {
            id: 'uses',
            header: t('designer.variables.usageCount'),
            accessor: (v) => variableUses(state.document, v.key).length,
          },
        ]}
      />
      <Dialog
        open={!!variable}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        title={t('designer.variables.edit')}
        description={t('designer.variables.renameDescription')}
      >
        {variable && (
          <VariableForm
            key={variable.key}
            variable={variable}
            store={store}
            close={() => {
              setSelected(null);
            }}
          />
        )}
      </Dialog>
    </section>
  );
}
