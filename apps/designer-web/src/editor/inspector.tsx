import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ArrowUp, ArrowDown, MousePointerClick, MoveVertical } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import {
  ActionSchema,
  JsonValueSchema,
  findNode,
  type Action,
  type Node,
  type Variable,
} from '@verbis/script-schema';
import { Input, Textarea, Select, Button, Tabs, Alert } from '@verbis/ui';

import { RuleBuilder } from '../rules/builder.js';
import { ruleDisplayName, ruleFields } from '../rules/fields.js';

import { ActionFields, useActionLabel, type ActionContext } from './actions.js';
import { ExpressionEditor } from './expression-lazy.js';
import { inputFieldKeys } from './inspector-fields.js';
import { BREAKPOINTS, editorRegistry, useEditor, type EditorStore } from './store.js';
import {
  BlocksField,
  ColumnsField,
  ConfirmField,
  isBlockRows,
  isColumnRows,
} from './structured-fields.js';
import { applyParamsSync } from './text-variables.js';
import { variableForInput, variableKeyFromLabel } from './value-variable.js';
import { VariableTextField } from './variable-text-field.js';

function BindingField({
  prop,
  binding,
  variables,
  change,
}: {
  prop: string;
  binding: Node['bindings'][number] | undefined;
  variables: readonly string[];
  change: (binding: Node['bindings'][number] | null) => void;
}) {
  const { t } = useTranslation();
  const [expr, setExpr] = useState(binding && 'expression' in binding ? binding.expression : '');
  return (
    <>
      <Select
        label={t('designer.editor.twoWay')}
        value={binding && 'variable' in binding ? binding.variable : 'none'}
        options={[
          { value: 'none', label: t('designer.editor.none') },
          ...variables.map((value) => ({ value, label: value })),
        ]}
        onValueChange={(variable) => {
          setExpr('');
          change(variable === 'none' ? null : { prop, variable });
        }}
      />
      <ExpressionEditor
        label={t('designer.editor.invalidExpression')}
        variables={variables}
        value={expr}
        onChange={setExpr}
      />
      <Button
        disabled={!prop}
        onClick={() => {
          change(expr ? { prop, expression: expr } : null);
        }}
      >
        {t('designer.editor.applyExpression')}
      </Button>
    </>
  );
}

const NEW_VARIABLE = '__new__';
/** Content texts where authors insert variables (`{musteriAdi}`); labels stay plain. */
const TEXT_WITH_VARIABLES = new Set(['textKey', 'titleKey', 'descriptionKey']);
const INPUT_TYPES = new Set(
  editorRegistry
    .list()
    .filter((d) => d.designerMeta.category === 'input')
    .map((d) => d.type),
);
/**
 * The variable an input writes to. Offered on the Properties tab because an unbound input keeps
 * its value only in the page and nothing downstream (rules, flow, outcome) can read it.
 */
function ValueVariableField({ store, node }: { store: EditorStore; node: Node }) {
  const { t } = useTranslation();
  const state = useEditor(store);
  const binding = node.bindings.find((b) => b.prop === 'value');
  const bound = binding && 'variable' in binding ? binding.variable : undefined;
  const expression = binding && 'expression' in binding;
  const labelKey = typeof node.props['labelKey'] === 'string' ? node.props['labelKey'] : undefined;
  const bind = (variable: string | null, created?: Variable) => {
    store.execute(() => {
      store.edit((d) => {
        if (created) d.variables.push(created);
        const current = findNode(d, node.id)?.node;
        if (!current) return;
        current.bindings = current.bindings.filter((b) => b.prop !== 'value');
        if (variable) current.bindings.push({ prop: 'value', variable });
      });
    });
  };
  return (
    <div className="ed-value-variable">
      <Select
        label={t('designer.editor.valueVariable')}
        value={bound ?? (expression ? 'expression' : 'none')}
        options={[
          { value: 'none', label: t('designer.editor.none') },
          ...(expression
            ? [{ value: 'expression', label: t('designer.editor.boundByExpression') }]
            : []),
          ...state.document.variables.map((v) => ({ value: v.key, label: v.key })),
          { value: NEW_VARIABLE, label: t('designer.editor.newVariable') },
        ]}
        onValueChange={(value) => {
          if (value === 'expression') return;
          if (value !== NEW_VARIABLE) {
            bind(value === 'none' ? null : value);
            return;
          }
          const typed = labelKey ? state.document.i18n.messages['tr']?.[labelKey] : undefined;
          const label = typed?.trim()
            ? typed
            : t(`designer.editor.componentNames.${node.type}`, { defaultValue: node.type });
          const key = variableKeyFromLabel(
            label,
            state.document.variables.map((v) => v.key),
          );
          bind(key, variableForInput(node.type, key, typed?.trim() ? typed : undefined));
        }}
      />
      <p className="ed-help">{t('designer.editor.valueVariableHint')}</p>
    </div>
  );
}

function JsonField({
  value,
  label,
  change,
  store,
  problemKey,
}: {
  value: unknown;
  label: string;
  change: (value: unknown) => void;
  store: EditorStore;
  problemKey: string;
}) {
  const { t } = useTranslation();
  const [source, setSource] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState<'json' | 'rejected' | null>(null);
  useEffect(() => {
    store.setFieldProblem(problemKey, !!error);
    return () => {
      store.setFieldProblem(problemKey, false);
    };
  }, [store, problemKey, error]);
  return (
    <>
      <Textarea
        label={label}
        value={source}
        onChange={(event) => {
          setSource(event.target.value);
        }}
        onBlur={() => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(source) as unknown;
          } catch {
            setError('json');
            return;
          }
          try {
            change(parsed);
            setError(null);
          } catch {
            setError('rejected');
          }
        }}
      />
      {/* D-09: say what is wrong and what a valid value looks like. */}
      {error && (
        <Alert title={label} tone="danger">
          {t(error === 'json' ? 'designer.editor.jsonInvalid' : 'designer.editor.jsonRejected', {
            example: JSON.stringify(value ?? {}),
          })}
        </Alert>
      )}
    </>
  );
}
interface OptionRow {
  value: string;
  labelKey: string;
  [extra: string]: unknown;
}
const isOptionRows = (value: unknown): value is OptionRow[] =>
  Array.isArray(value) &&
  value.every(
    (item) =>
      item !== null &&
      typeof item === 'object' &&
      typeof (item as OptionRow).value === 'string' &&
      typeof (item as OptionRow).labelKey === 'string',
  );
/** D-09: option rows (value + TR/EN label) instead of hand-written JSON. */
function OptionsField({
  store,
  nodeId,
  label,
  rows,
  messages,
  prop = 'options',
}: {
  store: EditorStore;
  nodeId: string;
  label: string;
  rows: OptionRow[];
  messages: Record<string, Record<string, string> | undefined>;
  /** `options` for choice fields, `items` for tabs, accordions and steppers. */
  prop?: 'options' | 'items';
}) {
  const copy = prop === 'items' ? 'designer.editor.itemRows' : 'designer.editor.options';
  const { t } = useTranslation(),
    [problem, setProblem] = useState<{ index: number; key: string } | null>(null);
  const base = `editor.${nodeId.replaceAll('-', '.')}.${prop}`;
  useEffect(() => {
    store.setFieldProblem(`${nodeId}.${prop}`, !!problem);
    return () => {
      store.setFieldProblem(`${nodeId}.${prop}`, false);
    };
  }, [store, nodeId, problem, prop]);
  const commit = (
    next: OptionRow[],
    text?: { key: string; locale: string; value: string },
    dropped: readonly string[] = [],
  ) => {
    store.execute(() => {
      store.edit((d) => {
        const current = findNode(d, nodeId)?.node;
        if (!current) return;
        current.props[prop] = JsonValueSchema.parse(next);
        // D-09: label messages of removed options would otherwise linger in the catalogs.
        for (const catalog of Object.values(d.i18n.messages))
          for (const key of dropped) Reflect.deleteProperty(catalog, key);
        if (text) {
          d.i18n.messages[text.locale] ??= {};
          const catalog = d.i18n.messages[text.locale];
          if (catalog) catalog[text.key] = text.value;
        }
      });
    });
  };
  const move = (index: number, delta: number) => {
    const next = [...rows],
      [row] = next.splice(index, 1);
    if (!row) return;
    next.splice(index + delta, 0, row);
    commit(next);
  };
  return (
    <fieldset className="ed-options">
      <legend>{t(`${copy}.title`)}</legend>
      <p className="ed-help">{t(`${copy}.hint`)}</p>
      {rows.map((row, index) => (
        <fieldset key={row.labelKey} className="ed-option-row" aria-label={`#${index + 1}`}>
          <Input
            label={t(`${copy}.value`)}
            defaultValue={row.value}
            onChange={(event) => {
              const value = event.target.value.trim();
              const reason = !value
                ? `${copy}.empty`
                : rows.some((other, i) => i !== index && other.value === value)
                  ? `${copy}.duplicate`
                  : null;
              setProblem(reason ? { index, key: reason } : null);
              if (!reason) commit(rows.map((r, i) => (i === index ? { ...r, value } : r)));
            }}
          />
          {problem?.index === index && (
            <p role="alert" className="ed-help">
              {t(problem.key)}
            </p>
          )}
          {['tr', 'en'].map((locale) => (
            <Input
              key={locale}
              label={`${t(`${copy}.label`)} · ${locale.toUpperCase()}`}
              value={messages[locale]?.[row.labelKey] ?? ''}
              onChange={(event) => {
                commit(rows, { key: row.labelKey, locale, value: event.target.value });
              }}
            />
          ))}
          <div className="ed-option-actions">
            <Button
              size="sm"
              variant="ghost"
              disabled={index === 0}
              aria-label={t(`${copy}.moveUp`)}
              onClick={() => {
                move(index, -1);
              }}
            >
              <ArrowUp size={14} aria-hidden />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={index === rows.length - 1}
              aria-label={t(`${copy}.moveDown`)}
              onClick={() => {
                move(index, 1);
              }}
            >
              <ArrowDown size={14} aria-hidden />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setProblem(null);
                commit(
                  rows.filter((_, i) => i !== index),
                  undefined,
                  [row.labelKey],
                );
              }}
            >
              {t(`${copy}.remove`)}
            </Button>
          </div>
        </fieldset>
      ))}
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          let n = rows.length + 1;
          while (rows.some((r) => r.value === `option${n}` || r.labelKey === `${base}.option${n}`))
            n++;
          commit([...rows, { value: `option${n}`, labelKey: `${base}.option${n}` }]);
        }}
      >
        {t(`${copy}.add`)}
      </Button>
      <span className="vb-sr-only">{label}</span>
    </fieldset>
  );
}
function ActionRow({
  id,
  action,
  change,
  remove,
  move,
  context,
}: {
  id: string;
  action: Action;
  change: (action: Action) => void;
  remove: () => void;
  move: (delta: number) => void;
  context: ActionContext;
}) {
  const { t } = useTranslation();
  const sort = useSortable({ id });
  const name = useActionLabel(context);
  return (
    <div ref={sort.setNodeRef} className="ed-action">
      <Button
        variant="ghost"
        {...sort.attributes}
        {...sort.listeners}
        aria-label={t('designer.editor.reorder')}
      >
        <MoveVertical size={14} aria-hidden /> {name(action)}
      </Button>
      <ActionFields action={action} onChange={change} context={context} />
      <Button
        variant="ghost"
        aria-label={t('designer.editor.moveUp')}
        onClick={() => {
          move(-1);
        }}
      >
        <ArrowUp size={14} />
      </Button>
      <Button
        variant="ghost"
        aria-label={t('designer.editor.moveDown')}
        onClick={() => {
          move(1);
        }}
      >
        <ArrowDown size={14} />
      </Button>
      <Button variant="ghost" onClick={remove}>
        {t('designer.editor.delete')}
      </Button>
    </div>
  );
}
export function Inspector({ store }: { store: EditorStore }) {
  const state = useEditor(store);
  const { t } = useTranslation();
  const [tab, setTab] = useState('properties');
  const node = state.selection[0] ? store.node(state.selection[0]) : undefined;
  const [event, setEvent] = useState('');
  const [prop, setProp] = useState('');
  if (!node)
    return (
      <div className="ed-inspector-empty">
        <span className="ed-inspector-empty-icon" aria-hidden>
          <MousePointerClick size={22} />
        </span>
        <strong>{t('designer.editor.selectTitle')}</strong>
        <p className="ed-muted">{t('designer.editor.selectHint')}</p>
        <small>{t('designer.editor.selectTip')}</small>
      </div>
    );
  const definition = editorRegistry.get(node.type),
    variables = state.document.variables.map((v) => v.key);
  const update = (work: Parameters<EditorStore['update']>[1]) => {
    store.execute(() => {
      store.update(node.id, work);
    });
  };
  const actionContext: ActionContext = {
    document: state.document,
    message: (key, locale) => state.document.i18n.messages[locale]?.[key] ?? '',
    editMessage: (key, locale, text) => {
      store.execute(() => {
        store.edit((d) => {
          d.i18n.messages[locale] ??= {};
          const catalog = d.i18n.messages[locale];
          catalog[key] = text;
        });
      });
    },
    newMessageKey: () =>
      `editor.${node.id.replace(/[^a-zA-Z0-9]+/g, '.')}.message.${crypto.randomUUID().slice(0, 8)}`,
    isInput: (type) => INPUT_TYPES.has(type),
    pageId: state.pageId,
  };
  const properties = definition.designerMeta.properties ?? [];
  const schema = z.toJSONSchema(definition.propsSchema, { unrepresentable: 'any' }) as {
    properties?: Record<string, { type?: string; enum?: string[]; default?: unknown }>;
  };
  const fields = properties.length
    ? properties
    : Object.keys(schema.properties ?? {}).map((key) => ({
        key,
        labelKey: `components.properties.${key}`,
        control: 'text' as const,
      }));
  const selectedEvent = definition.events.includes(event) ? event : (definition.events[0] ?? '');
  const actions = node.events[selectedEvent] ?? [];
  // Inputs are almost always bound by their value, so open the binding tab on it.
  const selectedProp = definition.bindableProps.includes(prop)
    ? prop
    : (['value', 'checked'].find((key) => definition.bindableProps.includes(key)) ??
      definition.bindableProps[0] ??
      '');
  const propertyLabel = (key: string) => t(`components.properties.${key}`, { defaultValue: key });
  const binding = node.bindings.find((b) => b.prop === selectedProp);
  const setActions = (value: Action[]) => {
    update((n) => {
      n.events[selectedEvent] = value;
    });
  };
  const inputKeys = inputFieldKeys(node.type, definition.designerMeta.category);
  const primaryKeys =
    node.type === 'heading' || node.type === 'text'
      ? ['textKey', 'params', 'emphasis']
      : definition.designerMeta.category === 'script'
        ? [
            'textKey',
            'labelKey',
            'titleKey',
            'blocks',
            'options',
            'mustRead',
            'acknowledged',
            'tone',
          ]
        : inputKeys
          ? inputKeys.primary
          : definition.designerMeta.category === 'structure'
            ? [
                'titleKey',
                'descriptionKey',
                'labelKey',
                'items',
                'columns',
                'gap',
                'size',
                'arrayVariable',
                'itemKey',
              ]
            : definition.designerMeta.category === 'data'
              ? ['labelKey', 'ds', 'output', 'trigger', 'columns', 'queryVariable']
              : definition.designerMeta.category === 'action'
                ? [
                    'labelKey',
                    'variant',
                    'size',
                    'options',
                    'outcome',
                    'target',
                    'scheduledAt',
                    'disabled',
                  ]
                : definition.designerMeta.category === 'media'
                  ? [
                      'labelKey',
                      'url',
                      'altKey',
                      'captionsUrl',
                      'durationSec',
                      'value',
                      'tone',
                      'max',
                    ]
                  : fields.map((field) => field.key);
  const mainFields = fields.filter((field) => primaryKeys.includes(field.key));
  const advancedFields = fields.filter((field) =>
    inputKeys ? inputKeys.advanced.includes(field.key) : !primaryKeys.includes(field.key),
  );
  // Enumerated property values read as words ("Bold", "Horizontal"), not as code values.
  const choiceLabel = (value: string) =>
    t(`designer.editor.choices.${value}`, {
      defaultValue: t(`designer.editor.styleValues.${value.replace('/', '_')}`, {
        defaultValue: value,
      }),
    });
  const renderProperty = (field: (typeof fields)[number]) => {
    const description = schema.properties?.[field.key],
      value = node.props[field.key] ?? definition.defaults[field.key];
    const label = t(
      ['visible', 'intervalMs', 'watch', 'emptyWhen'].includes(field.key)
        ? `designer.editor.serviceFields.${field.key}`
        : field.labelKey,
      { defaultValue: field.key },
    );
    const write = (value: unknown) => {
      const parsed = JsonValueSchema.parse(value);
      update((n) => {
        n.props[field.key] = parsed;
      });
    };
    const options = ('options' in field ? field.options : undefined) ?? description?.enum;
    if (field.key === 'ds')
      return (
        <Select
          key={field.key}
          label={label}
          value={typeof value === 'string' ? value : ''}
          options={state.document.dataSources.map((ds) => ({ value: ds.id, label: ds.id }))}
          onValueChange={write}
        />
      );
    if (
      field.control === 'i18nKey' ||
      /^(label|title|text|description|placeholder|hint|message)Key$/.test(field.key)
    ) {
      const key =
        typeof value === 'string' ? value : `editor.${node.id.replaceAll('-', '.')}.${field.key}`;
      return (
        <div key={field.key}>
          {/* D-08: the generated i18n key is an implementation detail; only TR/EN text is edited. */}
          {['tr', 'en'].map((locale) => {
            const write = (text: string) => {
              store.execute(() => {
                store.edit((d) => {
                  const current = findNode(d, node.id)?.node;
                  if (!current) return;
                  current.props[field.key] = key;
                  d.i18n.messages[locale] ??= {};
                  const catalog = d.i18n.messages[locale];
                  catalog[key] = text;
                  // Placeholders in any of the node's texts drive its params binding.
                  applyParamsSync(d, current, definition.bindableProps.includes('params'));
                });
              });
            };
            const fieldLabel = `${label} · ${locale.toUpperCase()}`;
            const text = state.document.i18n.messages[locale]?.[key] ?? '';
            return TEXT_WITH_VARIABLES.has(field.key) &&
              definition.bindableProps.includes('params') ? (
              <VariableTextField
                key={locale}
                label={fieldLabel}
                value={text}
                variables={variables}
                onChange={write}
              />
            ) : (
              <Textarea
                key={locale}
                label={fieldLabel}
                value={text}
                onChange={(e) => {
                  write(e.target.value);
                }}
              />
            );
          })}
        </div>
      );
    }
    if (/icon/i.test(field.key))
      return (
        <Select
          key={field.key}
          label={label}
          value={typeof value === 'string' ? value : ''}
          options={(
            options ?? [
              'Square',
              'MousePointer2',
              'Search',
              'Phone',
              'Check',
              'Info',
              'AlertTriangle',
              'ArrowRight',
            ]
          ).map((value) => ({ value, label: choiceLabel(value) }))}
          onValueChange={write}
        />
      );
    if (/color|tone/i.test(field.key))
      return (
        <Select
          key={field.key}
          label={label}
          value={typeof value === 'string' ? value : 'neutral'}
          options={(options ?? ['neutral', 'primary', 'success', 'warning', 'danger', 'info']).map(
            (value) => ({ value, label: choiceLabel(value) }),
          )}
          onValueChange={write}
        />
      );
    if (
      (field.key === 'options' || field.key === 'items') &&
      (value === undefined || isOptionRows(value))
    )
      return (
        <OptionsField
          key={`${node.id}.${field.key}`}
          store={store}
          nodeId={node.id}
          label={label}
          rows={value ?? []}
          messages={state.document.i18n.messages}
          prop={field.key}
        />
      );
    if (field.key === 'blocks' && (value === undefined || isBlockRows(value)))
      return (
        <BlocksField
          key={`${node.id}.blocks`}
          store={store}
          node={node}
          rows={value ?? []}
          messages={state.document.i18n.messages}
          variables={variables}
          bindableParams={definition.bindableProps.includes('params')}
        />
      );
    if (
      field.key === 'columns' &&
      definition.designerMeta.category === 'data' &&
      (value === undefined || isColumnRows(value))
    )
      return (
        <ColumnsField
          key={`${node.id}.columns`}
          store={store}
          node={node}
          rows={value ?? []}
          messages={state.document.i18n.messages}
        />
      );
    if (field.key === 'confirm')
      return (
        <ConfirmField
          key={`${node.id}.confirm`}
          store={store}
          node={node}
          messages={state.document.i18n.messages}
        />
      );
    // Fields naming a variable pick from the script's variables instead of free text.
    if (/^(array|query)Variable$/.test(field.key))
      return (
        <Select
          key={field.key}
          label={label}
          value={typeof value === 'string' ? value : ''}
          options={state.document.variables
            .filter((v) => field.key !== 'arrayVariable' || v.type === 'array')
            .map((v) => ({
              value: v.key,
              label: v.key,
              hint: t(`designer.variables.types.${v.type}`),
            }))}
          onValueChange={write}
        />
      );
    if (field.control === 'json' || typeof value === 'object')
      return (
        <JsonField
          key={`${node.id}.${field.key}`}
          store={store}
          problemKey={`${node.id}.${field.key}`}
          label={label}
          value={value}
          change={write}
        />
      );
    if (options)
      return (
        <Select
          key={field.key}
          label={label}
          value={String(value ?? '')}
          options={options.map((value) => ({ value, label: choiceLabel(value) }))}
          onValueChange={write}
        />
      );
    if (field.control === 'boolean' || description?.type === 'boolean')
      return (
        <label key={field.key}>
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => {
              write(e.target.checked);
            }}
          />{' '}
          {label}
        </label>
      );
    return (
      <Input
        key={field.key}
        label={label}
        type={field.control === 'number' || description?.type === 'number' ? 'number' : 'text'}
        value={String(value ?? '')}
        onChange={(e) => {
          write(
            field.control === 'number' || description?.type === 'number'
              ? Number(e.target.value)
              : e.target.value,
          );
        }}
      />
    );
  };
  return (
    <aside
      className="ed-inspector"
      aria-label={t('designer.editor.properties')}
      data-coalesce-edits
    >
      <div className="ed-panel-title">
        <strong>
          {t(`designer.editor.componentNames.${node.type}`, { defaultValue: node.type })}
        </strong>
        {/* The stable id matters to integrators and support, not to authors: tucked away. */}
        <details className="ed-technical">
          <summary>{t('designer.editor.technical')}</summary>
          <code>{node.id}</code>
        </details>
      </div>
      <Tabs
        label={t('designer.editor.properties')}
        value={tab}
        onValueChange={setTab}
        items={['properties', 'style', 'binding', 'events', 'rules'].map((value) => ({
          value,
          label: t(`designer.editor.${value}`),
          content: <div />,
        }))}
      />
      <fieldset
        disabled={store.readonlyPages.has(store.location(node.id)?.pageId ?? '')}
        className="ed-fields"
      >
        {tab === 'properties' && (
          <>
            {definition.designerMeta.category === 'input' &&
              definition.bindableProps.includes('value') && (
                <ValueVariableField store={store} node={node} />
              )}
            <div className="ed-property-group">{mainFields.map(renderProperty)}</div>
            {advancedFields.length > 0 && (
              <details className="ed-advanced-properties" key={node.id}>
                <summary>{t('designer.editor.advancedProperties')}</summary>
                <div className="ed-property-group">{advancedFields.map(renderProperty)}</div>
              </details>
            )}
          </>
        )}
        {tab === 'style' && (
          <>
            {/* Mobile-first like the runtime: "all screens" is the safe default; narrower
                targets than the preview stay visible on the canvas. */}
            <Select
              label={t('designer.editor.styleScope')}
              value={state.breakpoint}
              options={BREAKPOINTS.map((value) => ({
                value,
                label: t(`designer.editor.styleScopes.${value}`),
              }))}
              onValueChange={(value) => {
                const target = BREAKPOINTS.find((point) => point === value);
                if (target) store.setView({ breakpoint: target });
              }}
            />
            {Object.entries({
              display: ['flex', 'grid', 'block'],
              direction: ['row', 'column'],
              gap: ['none', 'xs', 'sm', 'md', 'lg', 'xl'],
              padding: ['none', 'xs', 'sm', 'md', 'lg', 'xl'],
              align: ['start', 'center', 'end', 'stretch'],
              justify: ['start', 'center', 'end', 'between'],
              width: ['auto', 'full', '1/2', 'sm', 'md', 'lg'],
              tone: ['neutral', 'primary', 'success', 'warning', 'danger', 'info'],
            }).map(([key, options]) => (
              <Select
                key={key}
                label={t(`designer.editor.styleLabels.${key}`)}
                value={String(Reflect.get(node.style?.[state.breakpoint] ?? {}, key) ?? '')}
                options={[
                  { value: 'inherit', label: t('designer.editor.inherit') },
                  ...options.map((value) => ({
                    value,
                    label: t(`designer.editor.styleValues.${value.replace('/', '_')}`, {
                      defaultValue: value,
                    }),
                  })),
                ]}
                onValueChange={(value) => {
                  update((n) => {
                    n.style ??= {};
                    const style = n.style[state.breakpoint] ?? {};
                    if (value === 'inherit') Reflect.deleteProperty(style, key);
                    else Reflect.set(style, key, value);
                    n.style[state.breakpoint] = style;
                  });
                }}
              />
            ))}
            <Input
              label={t('designer.editor.columns')}
              type="number"
              min={1}
              max={12}
              value={node.style?.[state.breakpoint]?.columns ?? 1}
              onChange={(e) => {
                const columns = Number(e.target.value);
                update((n) => {
                  n.style ??= {};
                  n.style[state.breakpoint] = { ...n.style[state.breakpoint], columns };
                });
              }}
            />
          </>
        )}
        {tab === 'binding' && (
          <>
            <Select
              label={t('designer.editor.property')}
              value={selectedProp}
              options={definition.bindableProps.map((value) => ({
                value,
                label: propertyLabel(value),
              }))}
              onValueChange={setProp}
            />
            <BindingField
              key={node.id + selectedProp}
              prop={selectedProp}
              binding={binding}
              variables={variables}
              change={(binding) => {
                update((n) => {
                  n.bindings = n.bindings.filter((b) => b.prop !== selectedProp);
                  if (binding) n.bindings.push(binding);
                });
              }}
            />
          </>
        )}
        {tab === 'events' && (
          <>
            <Select
              label={t('designer.editor.event')}
              value={selectedEvent}
              options={definition.events.map((value) => ({
                value,
                label: t(`designer.editor.eventNames.${value}`, { defaultValue: value }),
              }))}
              onValueChange={setEvent}
            />
            <DndContext
              collisionDetection={closestCenter}
              onDragEnd={({ active, over }) => {
                if (!over || active.id === over.id) return;
                const from = Number(active.id),
                  to = Number(over.id),
                  copy = [...actions],
                  item = copy.splice(from, 1)[0];
                if (item) {
                  copy.splice(to, 0, item);
                  setActions(copy);
                }
              }}
            >
              <SortableContext
                items={actions.map((_, i) => String(i))}
                strategy={verticalListSortingStrategy}
              >
                {actions.map((action, i) => (
                  <ActionRow
                    key={i}
                    id={String(i)}
                    context={actionContext}
                    move={(delta) => {
                      const to = i + delta;
                      if (to < 0 || to >= actions.length) return;
                      const next = [...actions];
                      const item = next.splice(i, 1)[0];
                      if (item) {
                        next.splice(to, 0, item);
                        setActions(next);
                      }
                    }}
                    action={action}
                    change={(next) => {
                      setActions(actions.map((a, index) => (index === i ? next : a)));
                    }}
                    remove={() => {
                      setActions(actions.filter((_, index) => index !== i));
                    }}
                  />
                ))}
              </SortableContext>
            </DndContext>
            <Button
              disabled={!selectedEvent}
              onClick={() => {
                setActions([...actions, { type: 'next' }]);
              }}
            >
              {t('designer.editor.addAction')}
            </Button>
            <Button
              disabled={!selectedEvent}
              onClick={() => {
                const conditional = ActionSchema.parse({
                  type: 'conditional',
                  if: { $expr: 'true' },
                  then: [{ type: 'next' }],
                  else: [],
                });
                setActions([...actions, conditional]);
              }}
            >
              {t('designer.editor.addConditional')}
            </Button>
          </>
        )}
        {tab === 'rules' &&
          (['visibleWhen', 'enabledWhen', 'requiredWhen'] as const).map((key) => (
            <fieldset key={key}>
              <legend>{t(`designer.editor.${key}`)}</legend>
              {!(
                node[key] &&
                '$rule' in node[key] &&
                !node[key].$rule.startsWith(`rule-${node.id}-`)
              ) && (
                <RuleBuilder
                  key={`${node.id}-${key}-${JSON.stringify(node[key])}`}
                  fields={ruleFields(state.document)}
                  value={
                    node[key] && '$rule' in node[key]
                      ? (state.document.rules.find(
                          (r) => r.id === (node[key] as { $rule: string }).$rule,
                        )?.when ?? { $expr: 'true' })
                      : node[key] && '$expr' in node[key]
                        ? { $expr: node[key].$expr }
                        : { $expr: 'true' }
                  }
                  onChange={(value) => {
                    store.execute(() => {
                      if (store.readonlyPages.has(store.location(node.id)?.pageId ?? ''))
                        throw new Error('VERBIS_LINKED_READONLY');
                      const ruleId = `rule-${node.id}-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
                      store.batch(() => {
                        store.edit((doc) => {
                          const existing = doc.rules.find((r) => r.id === ruleId);
                          if (existing) existing.when = value;
                          else doc.rules.push({ id: ruleId, when: value, then: [] });
                        });
                        store.update(node.id, (draft) => {
                          draft[key] = { $rule: ruleId };
                        });
                      });
                    });
                  }}
                />
              )}
              <Select
                label={t('designer.editor.ruleReference')}
                value={node[key] && '$rule' in node[key] ? node[key].$rule : 'none'}
                options={[
                  { value: 'none', label: t('designer.editor.none') },
                  ...state.document.rules.map((r) => ({
                    value: r.id,
                    label: ruleDisplayName(r, state.document, (k, o) => t(k, o ?? {})),
                  })),
                ]}
                onValueChange={(value) => {
                  update((n) => {
                    if (value === 'none') Reflect.deleteProperty(n, key);
                    else n[key] = { $rule: value };
                  });
                }}
              />
            </fieldset>
          ))}
      </fieldset>
    </aside>
  );
}
