import { useState } from 'react';

import { Button, type RendererProps } from '@verbis/core-runtime';
import type { ActionInput } from '@verbis/script-schema';
import { Select, Input, Alert } from '@verbis/ui';

import { useComponentEnvironment } from './environment.js';
import { ActionPropsSchema } from './schemas.js';
import { Frame, CoreAction, useLabels, useField } from './shared.js';

export function ActionComponent(component: RendererProps) {
  const p = ActionPropsSchema.parse(component.props),
    { text, t } = useLabels(component),
    f = useField(component),
    environment = useComponentEnvironment();
  const [date, setDate] = useState(p.scheduledAt),
    [failed, setFailed] = useState(false);
  let actions: ActionInput[] | undefined,
    labelKey = p.labelKey;
  switch (component.node.type) {
    case 'nextButton':
      actions = [{ type: 'next' }];
      labelKey = p.labelKey === 'components.field' ? 'components.next' : p.labelKey;
      break;
    case 'backButton':
      actions = [{ type: 'back' }];
      labelKey = p.labelKey === 'components.field' ? 'components.back' : p.labelKey;
      break;
    case 'outcomeSubmit':
      actions = [{ type: 'submitOutcome', outcome: p.outcome }];
      labelKey = p.labelKey === 'components.field' ? 'components.submit' : p.labelKey;
      break;
    case 'transferHint':
      actions = [{ type: 'transferHint', target: p.target }];
      labelKey = p.labelKey === 'components.field' ? 'components.transfer' : p.labelKey;
      break;
  }
  let content;
  if (component.node.type === 'dispositionPicker')
    content = (
      <Select
        label={text(p.labelKey)}
        options={p.options.map((option) => ({ value: option.value, label: text(option.labelKey) }))}
        disabled={!component.enabled || p.disabled}
        value={typeof f.value === 'string' ? f.value : ''}
        onValueChange={(value) => {
          f.write(value);
          void component.runtime.executor
            .execute(
              [{ type: 'setDisposition', code: value }],
              component.runtime.signal,
              `ui:${component.node.id}`,
            )
            .catch(() => {
              setFailed(true);
            });
        }}
      />
    );
  else if (component.node.type === 'buttonGroup')
    content = (
      <>
        {p.options.map((option) => (
          <CoreAction
            key={option.value}
            component={{
              ...component,
              node: { ...component.node, id: `${component.node.id}-${option.value}` },
              enabled: component.enabled && !option.disabled,
              emit: async () => {
                if (option.page)
                  await component.runtime.executor.execute(
                    [{ type: 'navigate', page: option.page }],
                    component.runtime.signal,
                    `ui:${component.node.id}`,
                  );
                await component.emit('onPress');
              },
            }}
            labelKey={option.labelKey}
          />
        ))}
      </>
    );
  else if (component.node.type === 'callbackScheduler')
    content = (
      <>
        <Input
          label={text(p.labelKey)}
          type="datetime-local"
          disabled={!component.enabled || p.disabled}
          value={date}
          onChange={(event) => {
            setDate(event.target.value);
            setFailed(false);
          }}
        />
        <p className="vb-field-hint">{p.timeZone}</p>
        <CoreAction
          component={{
            ...component,
            enabled: component.enabled && environment.scheduleCallback !== undefined && date !== '',
            emit: async () => {
              const scheduled = new Date(date);
              if (!Number.isFinite(scheduled.getTime())) {
                setFailed(true);
                return;
              }
              if (!environment.scheduleCallback) return;
              component.runtime.event('component', 'started', undefined, component.node.id);
              try {
                await environment.scheduleCallback({
                  scheduledAt: date,
                  timeZone: p.timeZone,
                  signal: component.runtime.signal,
                });
                await component.emit('onPress');
                component.runtime.event('component', 'completed', undefined, component.node.id);
              } catch {
                setFailed(true);
                component.runtime.event(
                  'component',
                  'failed',
                  'VERBIS_CALLBACK_FAILED',
                  component.node.id,
                );
              }
            },
          }}
          labelKey="components.schedule"
        />
        {environment.scheduleCallback === undefined && (
          <Alert title={t('components.unavailable')} />
        )}
      </>
    );
  else
    content = (
      <Button
        {...component}
        props={{
          labelKey,
          variant: p.variant,
          size: p.size,
          disabled: p.disabled,
          loading: p.loading,
          ...(p.confirm ? { confirm: p.confirm } : {}),
          ...(p.iconKey ? { iconKey: p.iconKey } : {}),
        }}
        emit={async () => {
          if (actions)
            await component.runtime.executor.execute(
              actions,
              component.runtime.signal,
              `ui:${component.node.id}`,
            );
          await component.emit('onPress');
        }}
      />
    );
  return (
    <Frame component={component}>
      {content}
      {failed && <Alert title={t('components.invalid')} tone="danger" />}
    </Frame>
  );
}
