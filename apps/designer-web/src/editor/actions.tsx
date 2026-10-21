import { ArrowDown, ArrowUp } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { expressionToRule, ruleToExpression } from '@verbis/expr';
import {
  ActionSchema,
  ConditionSchema,
  PredicateSchema,
  type Action,
  type ActionType,
  type Condition,
  type Predicate,
  type ScriptDocument,
  type Value,
} from '@verbis/script-schema';
import { Alert, Button, Input, Select } from '@verbis/ui';

import { RuleBuilder } from '../rules/builder.js';
import { ruleDisplayName, ruleFields } from '../rules/fields.js';

import {
  ACTION_GROUPS,
  actionDetail,
  defaultAction,
  maskableNodes,
  timerNodes,
  type ActionNeed,
} from './action-catalog.js';
import { messageTokens, paramsValueMap } from './text-variables.js';
import { ValueEditor, valueKind } from './value-editor.js';
import { VariableTextField } from './variable-text-field.js';

/** Everything an action form reads from or writes to besides the action itself. */
export interface ActionContext {
  document: ScriptDocument;
  /** Text of a message key in a locale (empty when missing). */
  message: (key: string, locale: string) => string;
  /** Writes a message text as its own undoable edit. */
  editMessage: (key: string, locale: string, text: string) => void;
  newMessageKey: () => string;
  isInput: (type: string) => boolean;
  pageId?: string | undefined;
}
const LOCALES = ['tr', 'en'] as const;
const NESTED = {
  conditional: ['then', 'else'],
  callDataSource: ['onSuccess', 'onError'],
  validatePage: ['onInvalid'],
  sequence: ['actions'],
  parallel: ['actions'],
} as const;
const MAX_DEPTH = 8;

/** Readable name of an action plus its most telling parameter. */
export function useActionLabel(context: Pick<ActionContext, 'document' | 'message'>) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage === 'en' ? 'en' : 'tr';
  return (action: Action) => {
    const name = t(`designer.actions.names.${action.type}`);
    const detail = actionDetail(action, context.document, (key) => context.message(key, locale));
    return detail ? `${name} · ${detail}` : name;
  };
}

/** Converts a stored condition to the visual builder's tree; a single leaf gets its own group. */
export function conditionToPredicate(condition: Condition): Predicate {
  if (!('$expr' in condition)) return { $expr: 'true' };
  try {
    const parsed = PredicateSchema.parse(expressionToRule(condition.$expr));
    return 'fact' in parsed ? { all: [parsed] } : parsed;
  } catch {
    return { $expr: condition.$expr };
  }
}
export function predicateToCondition(predicate: Predicate): Condition {
  return ConditionSchema.parse(
    '$expr' in predicate ? { $expr: predicate.$expr } : { $expr: ruleToExpression(predicate) },
  );
}

/**
 * Typed, code-free form for one action. Switching type builds a valid action from the document
 * (first page, first variable…), so authors never type JSON; parameters use pickers and the
 * shared value editor.
 */
export function ActionFields({
  action,
  onChange,
  context,
  depth = 0,
}: {
  action: Action;
  onChange: (action: Action) => void;
  context: ActionContext;
  depth?: number;
}) {
  const { t } = useTranslation();
  const [need, setNeed] = useState<ActionNeed | null>(null),
    [invalid, setInvalid] = useState(false);
  const { document } = context;
  const patch = (changes: Record<string, unknown>) => {
    const result = ActionSchema.safeParse({ ...action, ...changes });
    if (result.success) {
      onChange(result.data);
      setInvalid(false);
    } else setInvalid(true);
    return result.success;
  };
  const variables = document.variables
    .filter((v) => v.scope !== 'global')
    .map((v) => ({ key: v.key, type: v.type }));
  const pages = document.pages.map((p) => ({ value: p.id, label: p.name }));
  return (
    <div className="ed-action-fields">
      <Select
        label={t('designer.editor.actionType')}
        value={action.type}
        options={ACTION_GROUPS.flatMap((group) =>
          group.types.map((type) => ({
            value: type,
            label: t(`designer.actions.names.${type}`),
            hint: t(`designer.actions.hints.${type}`),
            group: t(`designer.actions.groups.${group.id}`),
          })),
        )}
        onValueChange={(type) => {
          if (type === action.type) return;
          const created = defaultAction(type as ActionType, {
            document,
            messageKey: context.newMessageKey,
            isInput: context.isInput,
            pageId: context.pageId,
          });
          if ('need' in created) {
            setNeed(created.need);
            return;
          }
          setNeed(null);
          setInvalid(false);
          onChange(created.action);
        }}
      />
      {need && <Alert tone="info" title={t(`designer.actions.needs.${need}`)} />}
      <TypedFields
        action={action}
        patch={patch}
        context={context}
        variables={variables}
        pages={pages}
      />
      {depth < MAX_DEPTH &&
        action.type in NESTED &&
        NESTED[action.type as keyof typeof NESTED].map((key) => (
          <ActionList
            key={key}
            label={t(`designer.actions.fields.${key}`)}
            actions={(Reflect.get(action, key) as Action[] | undefined) ?? []}
            context={context}
            depth={depth + 1}
            onChange={(next) => {
              patch({ [key]: next });
            }}
          />
        ))}
      {invalid && <Alert title={t('designer.editor.actionInvalid')} tone="danger" />}
    </div>
  );
}

function TypedFields({
  action,
  patch,
  context,
  variables,
  pages,
}: {
  action: Action;
  patch: (changes: Record<string, unknown>) => boolean;
  context: ActionContext;
  variables: readonly { key: string; type: ScriptDocument['variables'][number]['type'] }[];
  pages: readonly { value: string; label: string }[];
}) {
  const { t } = useTranslation();
  const { document } = context;
  const label = (key: string) => t(`designer.actions.fields.${key}`);
  switch (action.type) {
    case 'next':
    case 'back':
    case 'closeModal':
      return <p className="ed-help">{t(`designer.actions.hints.${action.type}`)}</p>;
    case 'setVariable': {
      const target = document.variables.find((v) => v.key === action.variable);
      return (
        <>
          <Select
            label={label('variable')}
            value={action.variable}
            options={variables.map((v) => ({
              value: v.key,
              label: v.key,
              hint: t(`designer.variables.types.${v.type}`),
            }))}
            onValueChange={(variable) => {
              const next = document.variables.find((v) => v.key === variable);
              if (
                !patch({
                  variable,
                  value: next?.type === 'enum' ? (next.enumValues?.[0] ?? '') : action.value,
                })
              )
                patch({ variable, value: null });
            }}
          />
          <ValueEditor
            key={action.variable}
            label={label('value')}
            value={action.value}
            kind={valueKind(target?.type)}
            choices={target?.enumValues?.map((value) => ({ value, label: value }))}
            variables={variables}
            onChange={(value) => {
              patch({ value });
            }}
          />
        </>
      );
    }
    case 'callDataSource':
      return (
        <>
          <Select
            label={label('dataSource')}
            value={action.dataSource}
            options={document.dataSources.map((ds) => ({ value: ds.id, label: ds.id }))}
            onValueChange={(dataSource) => {
              patch({ dataSource });
            }}
          />
          {action.inputs && Object.keys(action.inputs).length > 0 && (
            <p className="ed-help">{t('designer.actions.customInputs')}</p>
          )}
        </>
      );
    case 'navigate':
    case 'openModal':
      return (
        <Select
          label={label(action.type === 'openModal' ? 'modalPage' : 'page')}
          value={action.page}
          options={pages}
          onValueChange={(page) => {
            patch({ page });
          }}
        />
      );
    case 'validatePage':
      return (
        <Select
          label={label('page')}
          value={action.page ?? '__current__'}
          options={[{ value: '__current__', label: label('currentPage') }, ...pages]}
          onValueChange={(page) => {
            patch({ page: page === '__current__' ? undefined : page });
          }}
        />
      );
    case 'showToast':
      return (
        <>
          <MessageFields
            messageKey={action.messageKey}
            context={context}
            onTokens={(tokens) => {
              patch({
                params: paramsValueMap(
                  tokens,
                  variables.map((v) => v.key),
                ),
              });
            }}
          />
          <Select
            label={label('tone')}
            value={action.tone}
            options={['info', 'success', 'warning', 'danger', 'neutral', 'primary'].map((tone) => ({
              value: tone,
              label: t(`designer.editor.styleValues.${tone}`),
            }))}
            onValueChange={(tone) => {
              patch({ tone });
            }}
          />
        </>
      );
    case 'submitOutcome':
      return (
        <>
          <CodeInput
            label={label('outcome')}
            hint={label('outcomeHint')}
            value={action.outcome}
            commit={(outcome) => patch({ outcome })}
          />
          <Select
            label={label('completion')}
            value={action.completion ?? 'complete'}
            options={['complete', 'early'].map((value) => ({
              value,
              label: t(`designer.actions.completion.${value}`),
              hint: t(`designer.actions.completionHints.${value}`),
            }))}
            onValueChange={(completion) => {
              patch({ completion: completion === 'complete' ? undefined : completion });
            }}
          />
          {action.notes === undefined ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                patch({ notes: '' });
              }}
            >
              {label('addNotes')}
            </Button>
          ) : (
            <>
              <ValueEditor
                label={label('notes')}
                value={action.notes}
                kind="string"
                variables={variables}
                onChange={(notes) => {
                  patch({ notes });
                }}
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  patch({ notes: undefined });
                }}
              >
                {label('removeNotes')}
              </Button>
            </>
          )}
        </>
      );
    case 'setDisposition':
      return (
        <>
          <CodeInput
            label={label('code')}
            hint={label('outcomeHint')}
            value={action.code}
            commit={(code) => patch({ code })}
          />
          <CodeInput
            label={label('subCode')}
            value={action.subCode ?? ''}
            optional
            commit={(subCode) => patch({ subCode: subCode || undefined })}
          />
        </>
      );
    case 'writeBackToPlatform':
      return (
        <AttributeRows
          attributes={action.attributes}
          variables={variables}
          commit={(attributes) => patch({ attributes })}
        />
      );
    case 'transferHint':
      return (
        <>
          <CodeInput
            label={label('target')}
            hint={label('targetHint')}
            value={action.target}
            commit={(target) => patch({ target })}
          />
          <OptionalMessage
            label={label('reason')}
            messageKey={action.reasonKey}
            context={context}
            assign={(reasonKey) => patch({ reasonKey })}
          />
        </>
      );
    case 'runSubflow':
      return (
        <Select
          label={label('flow')}
          value={action.flow}
          options={document.subflows.map((f) => ({ value: f.id, label: f.name ?? f.id }))}
          onValueChange={(flow) => {
            patch({ flow });
          }}
        />
      );
    case 'conditional':
      return (
        <ConditionField
          value={action.if}
          document={document}
          onChange={(condition) => {
            patch({ if: condition });
          }}
        />
      );
    case 'sequence':
    case 'parallel':
      return <p className="ed-help">{t(`designer.actions.hints.${action.type}`)}</p>;
    case 'emitEvent':
      return (
        <CodeInput
          label={label('event')}
          hint={label('eventHint')}
          value={action.name}
          commit={(name) => patch({ name })}
        />
      );
    case 'logEvent':
      return (
        <>
          <CodeInput
            label={label('event')}
            hint={label('eventHint')}
            value={action.event}
            commit={(event) => patch({ event })}
          />
          <Select
            label={label('level')}
            value={action.level}
            options={['info', 'warn', 'error', 'debug'].map((level) => ({
              value: level,
              label: t(`designer.actions.levels.${level}`),
            }))}
            onValueChange={(level) => {
              patch({ level });
            }}
          />
        </>
      );
    case 'startTimer':
    case 'stopTimer':
      return (
        <Select
          label={label('timer')}
          value={action.timer}
          options={timerNodes(document).map((node, index) => ({
            value: node.id,
            label: `${t(`designer.editor.componentNames.${node.type}`)} ${String(index + 1)}`,
          }))}
          onValueChange={(timer) => {
            patch({ timer });
          }}
        />
      );
    case 'maskField': {
      const labelOf = (node: { type: string; labelKey: string | undefined }) => {
        const text = node.labelKey ? context.message(node.labelKey, 'tr') : '';
        return text !== '' ? text : t(`designer.editor.componentNames.${node.type}`);
      };
      return (
        <>
          <Select
            label={label('node')}
            value={action.node}
            options={maskableNodes(document, context.isInput).map((node) => ({
              value: node.id,
              label: labelOf(node),
            }))}
            onValueChange={(node) => {
              patch({ node });
            }}
          />
          <Select
            label={label('masked')}
            value={action.masked ? 'true' : 'false'}
            options={[
              { value: 'true', label: t('designer.actions.maskOn') },
              { value: 'false', label: t('designer.actions.maskOff') },
            ]}
            onValueChange={(masked) => {
              patch({ masked: masked === 'true' });
            }}
          />
        </>
      );
    }
  }
}

/** Codes (outcomes, queues, event names) keep what the author typed until it is valid. */
function CodeInput({
  label,
  hint,
  value,
  commit,
  optional = false,
}: {
  label: string;
  hint?: string;
  value: string;
  commit: (value: string) => boolean;
  optional?: boolean;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(value),
    [invalid, setInvalid] = useState(false);
  return (
    <Input
      label={label}
      value={text}
      {...(hint === undefined ? {} : { hint })}
      {...(invalid ? { error: t('designer.actions.codeInvalid') } : {})}
      onChange={(event) => {
        setText(event.target.value);
        const next = event.target.value.trim();
        setInvalid(!(optional && !next) && !commit(next));
        if (optional && !next) commit('');
      }}
    />
  );
}

function MessageFields({
  messageKey,
  context,
  onTokens,
}: {
  messageKey: string;
  context: ActionContext;
  onTokens: (tokens: string[]) => void;
}) {
  const { t } = useTranslation();
  const keys = context.document.variables.map((v) => v.key);
  return (
    <>
      {LOCALES.map((locale) => (
        <VariableTextField
          key={locale}
          label={`${t('designer.actions.fields.message')} · ${locale.toUpperCase()}`}
          value={context.message(messageKey, locale)}
          variables={keys}
          rows={2}
          onChange={(text) => {
            const before = messageTokens(
              ...LOCALES.map((other) => context.message(messageKey, other)),
            );
            context.editMessage(messageKey, locale, text);
            const after = messageTokens(
              ...LOCALES.map((other) =>
                other === locale ? text : context.message(messageKey, other),
              ),
            );
            if (before.join() !== after.join()) onTokens(after);
          }}
        />
      ))}
    </>
  );
}

function OptionalMessage({
  label,
  messageKey,
  context,
  assign,
}: {
  label: string;
  messageKey: string | undefined;
  context: ActionContext;
  assign: (key: string) => boolean;
}) {
  const { t } = useTranslation();
  if (!messageKey)
    return (
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          assign(context.newMessageKey());
        }}
      >
        {t('designer.actions.addText', { field: label })}
      </Button>
    );
  return (
    <>
      {LOCALES.map((locale) => (
        <VariableTextField
          key={locale}
          label={`${label} · ${locale.toUpperCase()}`}
          value={context.message(messageKey, locale)}
          variables={[]}
          rows={2}
          onChange={(text) => {
            context.editMessage(messageKey, locale, text);
          }}
        />
      ))}
    </>
  );
}

function AttributeRows({
  attributes,
  variables,
  commit,
}: {
  attributes: Record<string, Value>;
  variables: readonly { key: string; type: ScriptDocument['variables'][number]['type'] }[];
  commit: (attributes: Record<string, Value>) => boolean;
}) {
  const { t } = useTranslation();
  const rows = Object.entries(attributes);
  const rename = (from: string, to: string) =>
    commit(Object.fromEntries(rows.map(([key, value]) => [key === from ? to : key, value])));
  return (
    <fieldset className="ed-attribute-rows">
      <legend>{t('designer.actions.fields.attributes')}</legend>
      {rows.length === 0 && <p className="ed-help">{t('designer.actions.noAttributes')}</p>}
      {rows.map(([key, value], index) => (
        <div key={index} className="ed-attribute-row">
          <CodeInput
            label={t('designer.actions.fields.attribute')}
            hint={t('designer.actions.fields.attributeHint')}
            value={key}
            commit={(next) => rename(key, next)}
          />
          <ValueEditor
            label={t('designer.actions.fields.attributeValue')}
            value={value}
            kind="any"
            variables={variables}
            onChange={(next) => {
              commit({ ...attributes, [key]: next });
            }}
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              commit(Object.fromEntries(rows.filter(([other]) => other !== key)));
            }}
          >
            {t('designer.actions.removeAttribute')}
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          let n = rows.length + 1;
          while (`attribute${String(n)}` in attributes) n++;
          commit({ ...attributes, [`attribute${String(n)}`]: '' });
        }}
      >
        {t('designer.actions.addAttribute')}
      </Button>
    </fieldset>
  );
}

function ConditionField({
  value,
  document,
  onChange,
}: {
  value: Condition;
  document: ScriptDocument;
  onChange: (condition: Condition) => void;
}) {
  const { t } = useTranslation();
  const rule = '$rule' in value ? value.$rule : null;
  return (
    <fieldset className="ed-condition">
      <legend>{t('designer.actions.fields.condition')}</legend>
      <Select
        label={t('designer.actions.fields.rule')}
        value={rule ?? '__inline__'}
        options={[
          { value: '__inline__', label: t('designer.actions.inlineCondition') },
          ...document.rules.map((r) => ({
            value: r.id,
            label: ruleDisplayName(r, document, (k, o) => t(k, o ?? {})),
          })),
        ]}
        onValueChange={(choice) => {
          onChange(choice === '__inline__' ? { $expr: 'true' } : { $rule: choice });
        }}
      />
      {!rule && (
        <RuleBuilder
          key={JSON.stringify(value)}
          value={conditionToPredicate(value)}
          fields={ruleFields(document)}
          onChange={(predicate) => {
            onChange(predicateToCondition(predicate));
          }}
        />
      )}
    </fieldset>
  );
}

/** Nested actions (then/else, on success/error…): add, reorder, remove, edit in place. */
export function ActionList({
  label,
  actions,
  onChange,
  context,
  depth,
}: {
  label: string;
  actions: readonly Action[];
  onChange: (actions: Action[]) => void;
  context: ActionContext;
  depth: number;
}) {
  const { t } = useTranslation();
  const name = useActionLabel(context);
  const move = (index: number, delta: number) => {
    const next = [...actions],
      [item] = next.splice(index, 1);
    if (!item) return;
    next.splice(index + delta, 0, item);
    onChange(next);
  };
  return (
    <fieldset className="ed-action-list">
      <legend>{label}</legend>
      {actions.length === 0 && <p className="ed-help">{t('designer.actions.emptyList')}</p>}
      {actions.map((action, index) => (
        <div key={index} className="ed-action-card">
          <div className="ed-action-card-head">
            <strong>{name(action)}</strong>
            <Button
              size="sm"
              variant="ghost"
              disabled={index === 0}
              aria-label={t('designer.editor.moveUp')}
              onClick={() => {
                move(index, -1);
              }}
            >
              <ArrowUp size={14} aria-hidden />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={index === actions.length - 1}
              aria-label={t('designer.editor.moveDown')}
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
                onChange(actions.filter((_, i) => i !== index));
              }}
            >
              {t('designer.editor.delete')}
            </Button>
          </div>
          <ActionFields
            action={action}
            context={context}
            depth={depth}
            onChange={(next) => {
              onChange(actions.map((item, i) => (i === index ? next : item)));
            }}
          />
        </div>
      ))}
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          onChange([...actions, { type: 'next' }]);
        }}
      >
        {t('designer.editor.addAction')}
      </Button>
    </fieldset>
  );
}
