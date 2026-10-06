import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ACTION_TYPES, ActionSchema, type Action } from '@verbis/script-schema';
import { Button, Input, Select, Textarea, Alert } from '@verbis/ui';

import { ExpressionEditor } from './expression-lazy.js';

export function ActionFields({
  action,
  onChange,
  variables,
  depth = 0,
}: {
  action: Action;
  onChange: (action: Action) => void;
  variables: readonly string[];
  depth?: number;
}) {
  const { t } = useTranslation();
  const [source, setSource] = useState(''),
    [error, setError] = useState(false);
  const change = (key: string, value: unknown) => {
    const result = ActionSchema.safeParse({ ...action, [key]: value });
    if (result.success) {
      onChange(result.data);
      setError(false);
    } else setError(true);
  };
  return (
    <>
      <Select
        label={t('designer.editor.actionType')}
        value={action.type}
        options={ACTION_TYPES.map((value) => ({ value, label: value }))}
        onValueChange={(type) => {
          const candidate = ActionSchema.safeParse({ ...action, type });
          if (candidate.success) onChange(candidate.data);
          else {
            setSource(JSON.stringify({ type }));
            setError(true);
          }
        }}
      />
      {(Object.entries(action) as [string, unknown][])
        .filter(([key]) => key !== 'type')
        .map(([key, value]) => {
          if (typeof value === 'string')
            return (
              <Input
                key={key}
                label={key}
                value={value}
                onChange={(e) => {
                  change(key, e.target.value);
                }}
              />
            );
          if (key === 'if' && action.type === 'conditional')
            return (
              <ExpressionEditor
                key={key}
                variables={variables}
                label={t('designer.editor.invalidExpression')}
                value={'$expr' in action.if ? action.if.$expr : ''}
                onChange={(value) => {
                  change('if', { $expr: value });
                }}
              />
            );
          if (
            Array.isArray(value) &&
            ['then', 'else', 'actions', 'onSuccess', 'onError', 'onInvalid'].includes(key) &&
            depth < 8
          )
            return (
              <div key={key}>
                <strong>{key}</strong>
                {(value as unknown[]).map((child, index) => {
                  const parsed = ActionSchema.safeParse(child);
                  return parsed.success ? (
                    <ActionFields
                      key={index}
                      action={parsed.data}
                      variables={variables}
                      depth={depth + 1}
                      onChange={(next) => {
                        change(
                          key,
                          (value as unknown[]).map((a, i) => (i === index ? next : a)),
                        );
                      }}
                    />
                  ) : null;
                })}
                <Button
                  variant="ghost"
                  onClick={() => {
                    change(key, [...(value as unknown[]), { type: 'next' }]);
                  }}
                >
                  {t('designer.editor.addAction')}
                </Button>
              </div>
            );
          return (
            <Textarea
              key={key}
              label={key}
              defaultValue={JSON.stringify(value, null, 2)}
              onBlur={(event) => {
                try {
                  change(key, JSON.parse(event.target.value) as unknown);
                } catch {
                  setError(true);
                }
              }}
            />
          );
        })}
      {source && (
        <>
          <Textarea
            label={t('designer.editor.actionParameters')}
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
            }}
          />
          <Button
            onClick={() => {
              try {
                onChange(ActionSchema.parse(JSON.parse(source) as unknown));
                setSource('');
                setError(false);
              } catch {
                setError(true);
              }
            }}
          >
            {t('designer.editor.apply')}
          </Button>
        </>
      )}
      {error && <Alert tone="warning" title={t('designer.editor.actionInvalid')} />}
    </>
  );
}
