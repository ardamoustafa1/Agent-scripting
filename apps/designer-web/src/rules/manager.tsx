import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Input, Select, Alert } from '@verbis/ui';

import { useEditor, type EditorStore } from '../editor/store.js';

import { RuleBuilder } from './builder.js';
import { ruleFields } from './fields.js';

export function RuleManager({
  store,
  readOnly = false,
}: {
  store: EditorStore;
  readOnly?: boolean;
}) {
  const state = useEditor(store),
    { t } = useTranslation();
  const [selected, setSelected] = useState(state.document.rules[0]?.id ?? '');
  const rule = state.document.rules.find((r) => r.id === selected);
  return (
    <section className="fd-manager">
      <div className="rb-manager-content">
        <h2>{t('designer.rules.title')}</h2>
        <div className="rb-manager-toolbar">
          <Select
            label={t('designer.rules.title')}
            value={selected}
            options={state.document.rules.map((r) => ({
              value: r.id,
              label: r.description ?? r.id,
            }))}
            onValueChange={setSelected}
          />
          <Button
            disabled={readOnly}
            onClick={() => {
              store.execute(() => {
                const id = `rule-${crypto.randomUUID()}`;
                store.edit((d) => {
                  d.rules.push({
                    id,
                    when: { all: [{ fact: 'interaction.channel', op: 'eq', value: 'voice' }] },
                    then: [],
                  });
                });
                setSelected(id);
              });
            }}
          >
            {t('designer.rules.add')}
          </Button>
        </div>
        {rule && (
          <fieldset disabled={readOnly}>
            <Input
              label={t('designer.rules.description')}
              value={rule.description ?? ''}
              onChange={(e) => {
                store.execute(() => {
                  store.edit((d) => {
                    const current = d.rules.find((r) => r.id === rule.id);
                    if (current) current.description = e.target.value;
                  });
                });
              }}
            />
            <RuleBuilder
              key={rule.id}
              value={rule.when}
              fields={ruleFields(state.document)}
              onChange={(value) => {
                if (readOnly) return;
                store.execute(() => {
                  store.edit((d) => {
                    const current = d.rules.find((r) => r.id === rule.id);
                    if (current) current.when = value;
                  });
                });
              }}
            />
          </fieldset>
        )}
        {state.message && <Alert title={t(state.message)} tone="danger" />}
      </div>
    </section>
  );
}
