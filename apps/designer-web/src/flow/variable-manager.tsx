import { Variable as VariableIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  VariableSchema,
  literalMatchesType,
  VariableTypeSchema,
  VariableScopeSchema,
  ClassificationSchema,
  JsonValueSchema,
  IdentifierSchema,
  type JsonValue,
  type Variable,
} from '@verbis/script-schema';
import { Button, Input, Select, DataTable, Dialog, Alert, EmptyState } from '@verbis/ui';

import { useEditor, type EditorStore } from '../editor/store.js';
import { ValueEditor, valueKind } from '../editor/value-editor.js';

import { jsonDefault, renameVariable, variableUses } from './variables.js';

/** Initial values as authors read them: no quotes, Yes/No, comma lists, "—" when empty. */
export function displayValue(value: JsonValue | undefined, t: (key: string) => string): string {
  if (value === undefined || value === null || value === '') return '—';
  if (value === true) return t('designer.value.yes');
  if (value === false) return t('designer.value.no');
  if (Array.isArray(value))
    return value.length ? value.map((item) => displayValue(item, t)).join(', ') : '—';
  if (typeof value === 'object') return Object.keys(value).length ? '{…}' : '—';
  return String(value);
}
type FieldErrors = Partial<
  Record<'name' | 'default' | 'enum' | 'source' | 'linked' | 'other', string>
>;
/** Same shape as VariableSchema.source: a dotted path under a runtime context root. */
const SOURCE_PATTERN = /^(interaction|agent|campaign)(\.[A-Za-z0-9_-]+)+$/;
function VariableForm({
  variable,
  store,
  close,
  isNew = false,
}: {
  variable: Variable;
  store: EditorStore;
  close: () => void;
  isNew?: boolean;
}) {
  const { t } = useTranslation();
  const [key, setKey] = useState(variable.key),
    // The data class is the single privacy control. A legacy variable flagged PII under a public
    // or internal class opens as personal data, so editing never silently drops the protection.
    [value, setValue] = useState<Variable>(
      variable.pii &&
        (variable.classification === 'public' || variable.classification === 'internal')
        ? { ...variable, classification: 'pii' }
        : variable,
    ),
    [initial, setInitial] = useState<JsonValue>(variable.default ?? jsonDefault(variable.type)),
    [origin, setOrigin] = useState(variable.source ?? ''),
    [errors, setErrors] = useState<FieldErrors>({});
  const uses = variableUses(store.getSnapshot().document, variable.key);
  const sensitive = value.classification === 'pii' || value.classification === 'pci';
  return (
    <>
      <Input
        label={t('designer.variables.name')}
        {...(errors.name ? { error: t(errors.name) } : {})}
        value={key}
        onChange={(e) => {
          setKey(e.target.value);
        }}
      />
      <Input
        label={t('designer.variables.displayName')}
        hint={t('designer.variables.displayNameHint')}
        maxLength={60}
        value={value.description ?? ''}
        onChange={(e) => {
          setValue({ ...value, description: e.target.value });
        }}
      />
      <Select
        label={t('designer.workspace.kind')}
        value={value.type}
        options={VariableTypeSchema.options.map((value) => ({
          value,
          label: t(`designer.variables.types.${value}`),
        }))}
        onValueChange={(type) => {
          const next = VariableTypeSchema.parse(type);
          setValue({
            ...value,
            type: next,
            ...(next === 'enum' ? { enumValues: ['option'] } : {}),
          });
          setInitial(next === 'enum' ? 'option' : jsonDefault(next));
        }}
      />
      <Select
        label={t('designer.workspace.scope')}
        value={value.scope}
        options={VariableScopeSchema.options.map((value) => ({
          value,
          label: t(`designer.variables.scopes.${value}`),
        }))}
        onValueChange={(scope) => {
          setValue({ ...value, scope: VariableScopeSchema.parse(scope) });
        }}
      />
      <Select
        label={t('designer.workspace.classification')}
        value={value.classification}
        options={ClassificationSchema.options.map((value) => ({
          value,
          label: t(`designer.variables.classifications.${value}`),
        }))}
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
      <Input
        label={t('designer.variables.source')}
        hint={t('designer.variables.sourceHint')}
        placeholder="interaction.ani"
        {...(errors.source ? { error: t(errors.source) } : {})}
        value={origin}
        onChange={(e) => {
          setOrigin(e.target.value);
        }}
      />
      {value.type === 'enum' && (
        <Input
          label={t('designer.variables.enum')}
          {...(errors.enum ? { error: t(errors.enum) } : {})}
          value={value.enumValues?.join(',') ?? ''}
          onChange={(e) => {
            const enumValues = e.target.value.split(',').map((v) => v.trim());
            setValue({ ...value, enumValues });
            if (typeof initial !== 'string' || !enumValues.includes(initial))
              setInitial(enumValues.find(Boolean) ?? '');
          }}
        />
      )}
      {sensitive ? (
        // Personal and card data never carry a stored starting value.
        <p className="ed-help">{t('designer.variables.sensitiveDefault')}</p>
      ) : (
        <ValueEditor
          key={value.type}
          label={t('designer.variables.default')}
          value={initial}
          kind={valueKind(value.type)}
          choices={value.enumValues?.filter(Boolean).map((option) => ({
            value: option,
            label: option,
          }))}
          variables={[]}
          allowSources={false}
          onChange={(next) => {
            const parsed = JsonValueSchema.safeParse(next);
            if (parsed.success) setInitial(parsed.data);
          }}
        />
      )}
      {errors.default && <Alert title={t(errors.default)} tone="danger" />}
      <details>
        <summary>{t('designer.variables.uses', { count: uses.length })}</summary>
        {uses.map((u) => (
          <code key={u.path}>
            {u.kind}: {u.path}
          </code>
        ))}
      </details>
      {(errors.linked ?? errors.other) && (
        <Alert title={t(errors.linked ?? errors.other ?? '')} tone="danger" />
      )}
      <Button
        onClick={() => {
          const found: FieldErrors = {};
          const name = IdentifierSchema.safeParse(key);
          if (!name.success) found.name = 'designer.variables.errors.name';
          else if (
            key !== variable.key &&
            store.getSnapshot().document.variables.some((v) => v.key === key)
          )
            found.name = 'designer.variables.errors.nameTaken';
          const parsedDefault: JsonValue = sensitive
            ? value.type === 'string'
              ? ''
              : null
            : initial;
          if (value.type === 'enum' && !value.enumValues?.some((v) => v !== ''))
            found.enum = 'designer.variables.errors.enumEmpty';
          const trimmedOrigin = origin.trim();
          if (trimmedOrigin && !SOURCE_PATTERN.test(trimmedOrigin))
            found.source = 'designer.variables.errors.source';
          if (Object.keys(found).length) {
            setErrors(found);
            return;
          }
          try {
            const { source: _previous, description, ...rest } = value;
            const displayName = description?.trim() ?? '';
            const parsed = VariableSchema.parse({
              ...rest,
              key,
              default: parsedDefault,
              ...(trimmedOrigin ? { source: trimmedOrigin } : {}),
              ...(displayName ? { description: displayName } : {}),
            });
            if (!literalMatchesType(parsed, parsed.default ?? null)) {
              setErrors({ default: 'designer.variables.errors.defaultType' });
              return;
            }
            const original = store.getSnapshot().document;
            if (
              [...store.readonlyPages].some((pageId) => {
                const page = original.pages.find((p) => p.id === pageId);
                return (
                  page &&
                  uses.some((u) => u.path.startsWith(`/pages/${original.pages.indexOf(page)}/`))
                );
              })
            ) {
              setErrors({ linked: 'designer.variables.errors.linked' });
              return;
            }
            store.execute(() => {
              if (isNew) {
                store.edit((d) => {
                  d.variables.push(parsed);
                });
              } else {
                const renamed = renameVariable(original, variable.key, key);
                store.edit((d) => {
                  Object.assign(d, renamed);
                  const index = d.variables.findIndex((v) => v.key === key);
                  d.variables[index] = parsed;
                });
              }
            });
            close();
          } catch {
            setErrors({ other: 'designer.variables.renameFailed' });
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
  const [selected, setSelected] = useState<string | null>(null),
    [draft, setDraft] = useState<Variable | null>(null);
  const variable = draft ?? state.document.variables.find((v) => v.key === selected);
  return (
    <section className="fd-manager">
      <div className="rb-manager-content">
        <header className="fd-manager-head">
          <div>
            <h2>{t('designer.variables.title')}</h2>
            <p>{t('designer.variables.intro')}</p>
          </div>
          <Button
            disabled={readOnly}
            onClick={() => {
              let index = 1;
              while (state.document.variables.some((v) => v.key === `variable${index}`)) index++;
              setSelected(null);
              setDraft(
                VariableSchema.parse({
                  key: `variable${index}`,
                  type: 'string',
                  scope: 'session',
                  default: '',
                }),
              );
            }}
          >
            {t('designer.variables.add')}
          </Button>
        </header>
        {state.document.variables.length === 0 ? (
          <EmptyState
            icon={<VariableIcon size={24} />}
            title={t('designer.variables.emptyTitle')}
            description={t('designer.variables.emptyBody')}
          />
        ) : (
          <DataTable
            label={t('designer.variables.title')}
            data={state.document.variables}
            getRowId={(v) => v.key}
            columns={[
              {
                id: 'key',
                // Sized to fit the 64rem manager column; the 180px default overflowed (6 × 180).
                size: 200,
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
              {
                id: 'type',
                size: 130,
                header: t('designer.workspace.kind'),
                accessor: (v) => t(`designer.variables.types.${v.type}`),
              },
              {
                id: 'scope',
                size: 140,
                header: t('designer.workspace.scope'),
                accessor: (v) => t(`designer.variables.scopes.${v.scope}`),
              },
              {
                id: 'pii',
                size: 170,
                header: t('designer.workspace.classification'),
                accessor: (v) => t(`designer.variables.classifications.${v.classification}`),
              },
              {
                id: 'default',
                size: 170,
                header: t('designer.variables.default'),
                accessor: (v) =>
                  v.pii || v.classification === 'pci'
                    ? '••••'
                    : displayValue(v.default, (key) => t(key)),
              },
              {
                id: 'uses',
                size: 110,
                header: t('designer.variables.usageCount'),
                accessor: (v) => variableUses(state.document, v.key).length,
              },
            ]}
          />
        )}
        <Dialog
          open={!!variable}
          onOpenChange={(open) => {
            if (!open) {
              setSelected(null);
              setDraft(null);
            }
          }}
          title={t(draft ? 'designer.variables.add' : 'designer.variables.edit')}
          description={t(
            draft ? 'designer.variables.addDescription' : 'designer.variables.renameDescription',
          )}
        >
          {variable && (
            <VariableForm
              key={draft ? `new:${variable.key}` : variable.key}
              variable={variable}
              store={store}
              isNew={!!draft}
              close={() => {
                setSelected(null);
                setDraft(null);
              }}
            />
          )}
        </Dialog>
      </div>
    </section>
  );
}
