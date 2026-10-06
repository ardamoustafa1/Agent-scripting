import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { expressionToRule, ruleToExpression } from '@verbis/expr';
import { PredicateSchema, type Predicate } from '@verbis/script-schema';
import { Button, Select, Input, Textarea, Alert } from '@verbis/ui';

import { ExpressionEditor } from '../editor/expression-lazy.js';

import { operators, type RuleField } from './fields.js';

function Tree({
  value,
  change,
  fields,
  depth = 0,
}: {
  value: Predicate;
  change: (value: Predicate) => void;
  fields: readonly RuleField[];
  depth?: number;
}) {
  const { t } = useTranslation();
  if (depth > 16) return <Alert title={t('designer.rules.depth')} tone="warning" />;
  if ('$expr' in value)
    return (
      <>
        <Alert title={t('designer.rules.advancedLeaf')} tone="info" />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            change({
              all: [{ fact: fields[0]?.path ?? 'interaction.channel', op: 'eq', value: '' }],
            });
          }}
        >
          {t('designer.rules.visual')}
        </Button>
        <ExpressionEditor
          value={value.$expr}
          variables={fields.filter((f) => f.path.startsWith('vars.')).map((f) => f.path.slice(5))}
          label={t('designer.editor.invalidExpression')}
          onChange={(source) => {
            if (source) change({ $expr: source });
          }}
        />
      </>
    );
  if ('not' in value)
    return (
      <div className="rb-group">
        <strong>{t('designer.rules.not')}</strong>
        <Tree
          value={value.not}
          change={(not) => {
            change({ not });
          }}
          fields={fields}
          depth={depth + 1}
        />
      </div>
    );
  if ('all' in value || 'any' in value) {
    const all = 'all' in value,
      items = all ? value.all : value.any;
    const next = (items: Predicate[]) => {
      change(all ? { all: items } : { any: items });
    };
    return (
      <fieldset className="rb-group">
        <legend>{t('designer.rules.group')}</legend>
        <Select
          label={t('designer.rules.logic')}
          value={all ? 'all' : 'any'}
          options={['all', 'any'].map((value) => ({ value, label: t(`designer.rules.${value}`) }))}
          onValueChange={(kind) => {
            change(kind === 'all' ? { all: items } : { any: items });
          }}
        />
        {items.map((item, index) => (
          <div key={index}>
            <Tree
              value={item}
              change={(value) => {
                next(items.map((p, i) => (i === index ? value : p)));
              }}
              fields={fields}
              depth={depth + 1}
            />
            <Button
              variant="ghost"
              disabled={items.length === 1}
              onClick={() => {
                next(items.filter((_, i) => i !== index));
              }}
            >
              {t('designer.editor.delete')}
            </Button>
          </div>
        ))}
        <div className="rb-actions">
          <Button
            variant="ghost"
            onClick={() => {
              next([
                ...items,
                { fact: fields[0]?.path ?? 'interaction.channel', op: 'eq', value: '' },
              ]);
            }}
          >
            {t('designer.rules.addCondition')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              next([
                ...items,
                { all: [{ fact: fields[0]?.path ?? 'interaction.channel', op: 'eq', value: '' }] },
              ]);
            }}
          >
            {t('designer.rules.addGroup')}
          </Button>
        </div>
      </fieldset>
    );
  }
  const field = fields.find((f) => f.path === value.fact),
    type = field?.type ?? 'unknown';
  const choices = operators(type);
  return (
    <div className="rb-leaf">
      <Select
        label={t('designer.rules.field')}
        value={value.fact}
        options={[
          ...fields,
          ...(field ? [] : [{ path: value.fact, label: value.fact, type: 'unknown' as const }]),
        ].map((f) => ({ value: f.path, label: f.label }))}
        onValueChange={(fact) => {
          const field = fields.find((f) => f.path === fact);
          change({
            fact,
            op: 'eq',
            value: field?.type === 'number' ? 0 : field?.type === 'boolean' ? false : '',
          });
        }}
      />
      <Select
        label={t('designer.rules.operator')}
        value={value.op}
        options={choices.map((value) => ({ value, label: t(`designer.rules.ops.${value}`) }))}
        onValueChange={(op) => {
          if (op === 'empty') {
            change({
              any: [
                { fact: value.fact, op: 'eq', value: null },
                { fact: value.fact, op: 'eq', value: '' },
              ],
            });
            return;
          }
          if (op === 'dateRange') {
            const now = '2000-01-01';
            change({
              all: [
                {
                  any: [
                    { fact: value.fact, op: 'after', value: now },
                    { fact: value.fact, op: 'eq', value: now },
                  ],
                },
                {
                  any: [
                    { fact: value.fact, op: 'before', value: now },
                    { fact: value.fact, op: 'eq', value: now },
                  ],
                },
              ],
            });
            return;
          }
          change(
            PredicateSchema.parse({
              ...value,
              op,
              value: ['in', 'notIn', 'between'].includes(op)
                ? op === 'between'
                  ? value.op === 'between'
                    ? value.value
                    : [0, 1]
                  : ['in', 'notIn'].includes(value.op) && Array.isArray(value.value)
                    ? value.value
                    : []
                : Array.isArray(value.value) &&
                    ['number', 'boolean', 'string', 'date', 'enum'].includes(type)
                  ? type === 'number'
                    ? 0
                    : type === 'boolean'
                      ? false
                      : ''
                  : value.value,
            }),
          );
        }}
      />
      {value.op !== 'exists' &&
        (type === 'boolean' ? (
          <Select
            label={t('designer.rules.value')}
            value={value.value === true ? 'true' : 'false'}
            options={['true', 'false'].map((value) => ({ value, label: value }))}
            onValueChange={(choice) => {
              change({ ...value, value: choice === 'true' });
            }}
          />
        ) : Array.isArray(value.value) || ['in', 'notIn', 'between'].includes(value.op) ? (
          <JsonValue key={JSON.stringify(value.value)} value={value} change={change} />
        ) : (
          <Input
            label={t('designer.rules.value')}
            type={type === 'number' ? 'number' : type === 'date' ? 'date' : 'text'}
            value={typeof value.value === 'object' ? '' : String(value.value ?? '')}
            onChange={(event) => {
              change({
                ...value,
                value: type === 'number' ? Number(event.target.value) : event.target.value,
              });
            }}
          />
        ))}
    </div>
  );
}
function JsonValue({
  value,
  change,
}: {
  value: Extract<Predicate, { fact: string }>;
  change: (value: Predicate) => void;
}) {
  const { t } = useTranslation(),
    [source, setSource] = useState(JSON.stringify(value.value ?? [])),
    [error, setError] = useState(false);
  return (
    <>
      <Textarea
        label={t('designer.rules.value')}
        value={source}
        onChange={(e) => {
          setSource(e.target.value);
        }}
        onBlur={() => {
          try {
            change(PredicateSchema.parse({ ...value, value: JSON.parse(source) as unknown }));
            setError(false);
          } catch {
            setError(true);
          }
        }}
      />
      {error && <Alert title={t('designer.rules.invalid')} tone="danger" />}
    </>
  );
}
export function RuleBuilder({
  value,
  onChange,
  fields,
}: {
  value: Predicate;
  onChange: (value: Predicate) => void;
  fields: readonly RuleField[];
}) {
  const { t } = useTranslation();
  const [advanced, setAdvanced] = useState(false),
    [source, setSource] = useState(() => {
      try {
        return ruleToExpression(value);
      } catch {
        return '$expr' in value ? value.$expr : '';
      }
    }),
    [error, setError] = useState(false);
  const toggle = () => {
    try {
      if (advanced) {
        onChange(PredicateSchema.parse(expressionToRule(source)));
        setAdvanced(false);
      } else {
        setSource(ruleToExpression(value));
        setAdvanced(true);
      }
      setError(false);
    } catch {
      setError(true);
    }
  };
  return (
    <div className="rb-builder">
      <Button size="sm" variant="ghost" onClick={toggle}>
        {t(advanced ? 'designer.rules.visual' : 'designer.rules.advanced')}
      </Button>
      {advanced ? (
        <>
          <ExpressionEditor
            value={source}
            onChange={setSource}
            variables={fields.filter((f) => f.path.startsWith('vars.')).map((f) => f.path.slice(5))}
            label={t('designer.editor.invalidExpression')}
          />
          <Button
            onClick={() => {
              try {
                onChange(PredicateSchema.parse(expressionToRule(source)));
                setError(false);
              } catch {
                setError(true);
              }
            }}
          >
            {t('designer.editor.apply')}
          </Button>
        </>
      ) : (
        <Tree value={value} change={onChange} fields={fields} />
      )}{' '}
      {error && <Alert title={t('designer.rules.invalid')} tone="danger" />}
    </div>
  );
}
