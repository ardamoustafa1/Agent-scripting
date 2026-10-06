import { Children, useState } from 'react';

import {
  Box,
  NodeRenderer,
  useRuntimePaths,
  RuntimeProblem,
  type RendererProps,
} from '@verbis/core-runtime';
import { JsonValueSchema, type JsonValue, type Node } from '@verbis/script-schema';
import { Tabs, Accordion, Dialog, Progress, Alert } from '@verbis/ui';

import { readPath } from './environment.js';
import { LayoutSchema } from './schemas.js';
import { Frame, CoreAction, ItemContext, useLabels } from './shared.js';

function setPath(input: JsonValue, path: string, value: JsonValue): JsonValue {
  const parts = path.split('.');
  if (parts.some((key) => ['__proto__', 'prototype', 'constructor'].includes(key)))
    throw new RuntimeProblem('VERBIS_REPEATER_PATH');
  const copy =
    input !== null && typeof input === 'object' && !Array.isArray(input) ? { ...input } : {};
  const key = parts.shift();
  if (!key) return value;
  copy[key] = parts.length ? setPath(copy[key] ?? {}, parts.join('.'), value) : value;
  return copy;
}
function cloneNode(node: Node, prefix: string): Node {
  return {
    ...node,
    id: `${prefix}-${node.id}`,
    children: node.children?.map((child) => cloneNode(child, prefix)),
  };
}
export function LayoutComponent(component: RendererProps) {
  const p = LayoutSchema.parse(component.props),
    { text, t } = useLabels(component);
  const [step, setStep] = useState(0),
    [open, setOpen] = useState(p.open);
  useRuntimePaths(component.runtime, [`vars.${p.arrayVariable}`]);
  const children = Children.toArray(component.children);
  if (component.node.type === 'repeater') {
    const definition = component.runtime.document.variables.find((v) => v.key === p.arrayVariable);
    if (
      definition?.type !== 'array' ||
      component.runtime.store.classification(p.arrayVariable) === 'pci'
    )
      throw new RuntimeProblem('VERBIS_REPEATER_VARIABLE');
    const rows = component.runtime.store.variable(p.arrayVariable);
    if (!Array.isArray(rows))
      return (
        <Frame component={component}>
          <Alert title={t('components.empty')} />
        </Frame>
      );
    const keys = new Set<string>();
    return (
      <Frame component={component}>
        {rows.slice(0, p.limit).map((row, index) => {
          const id = readPath(row, p.itemKey);
          if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(id) || keys.has(id))
            throw new RuntimeProblem('VERBIS_REPEATER_KEY');
          keys.add(id);
          const update = (path: string, value: JsonValue) => {
            if (!component.enabled || p.disabled) return;
            const current = component.runtime.store.variable(p.arrayVariable);
            if (!Array.isArray(current)) return;
            const rowIndex = current.findIndex((item) => readPath(item, p.itemKey) === id);
            if (rowIndex < 0) return;
            const next = current.map((item, i) =>
              i === rowIndex ? setPath(item, path, JsonValueSchema.parse(value)) : item,
            );
            component.runtime.store.setVariable(p.arrayVariable, next);
            component.runtime.recordInput({
              type: 'variable',
              variable: p.arrayVariable,
              value: next,
            });
          };
          return (
            <ItemContext.Provider key={id} value={{ item: row, index, update }}>
              {(component.node.children ?? []).map((child, childIndex) => (
                <NodeRenderer
                  key={child.id}
                  node={cloneNode(child, `${component.node.id}-${id}`)}
                  sourceNode={
                    (component.sourceNode ?? component.node).children?.[childIndex] ?? child
                  }
                  runtime={component.runtime}
                />
              ))}
            </ItemContext.Provider>
          );
        })}
      </Frame>
    );
  }
  let content;
  switch (component.node.type) {
    case 'tabs':
      content = (
        <Tabs
          label={text(p.labelKey)}
          items={p.items.map((item, index) => ({
            value: item.value,
            label: text(item.labelKey),
            content: children[index],
            disabled: item.disabled || !component.enabled,
          }))}
          {...(typeof p.value === 'string' && p.value ? { value: p.value } : {})}
          onValueChange={(value) => {
            if (component.node.bindings.some((b) => b.prop === 'value'))
              component.write('value', value);
            void component.emit('onChange').catch(() => undefined);
          }}
        />
      );
      break;
    case 'accordion':
      content = (
        <Accordion
          items={p.items.map((item, index) => ({
            value: item.value,
            title: text(item.labelKey),
            content: children[index],
            disabled: item.disabled || !component.enabled,
          }))}
        />
      );
      break;
    case 'stepper':
    case 'wizard':
      content = (
        <>
          <ol className="vc-steps" aria-label={text(p.labelKey)}>
            {p.items.map((item, index) => (
              <li key={item.value} aria-current={index === step ? 'step' : undefined}>
                {text(item.labelKey)}
              </li>
            ))}
          </ol>
          <Progress
            label={text(p.labelKey)}
            value={p.items.length ? ((step + 1) / p.items.length) * 100 : 0}
          />
          {children[step]}
          <CoreAction
            component={{
              ...component,
              node: { ...component.node, id: `${component.node.id}-back` },
              enabled: component.enabled && step > 0,
              emit: async () => {
                setStep((value) => Math.max(0, value - 1));
                await component.emit('onChange');
              },
            }}
            labelKey="components.back"
          />
          <CoreAction
            component={{
              ...component,
              node: { ...component.node, id: `${component.node.id}-next` },
              enabled: component.enabled && step < Math.max(children.length, p.items.length) - 1,
              emit: async () => {
                const page = component.runtime.store.get('runtime.page');
                if (
                  typeof page === 'string' &&
                  (await component.runtime.validation.page(page)).length
                )
                  return;
                setStep((value) => value + 1);
                await component.emit('onChange');
              },
            }}
            labelKey="components.next"
          />
        </>
      );
      break;
    case 'modal':
      content = (
        <>
          <CoreAction
            component={{
              ...component,
              emit: () => {
                setOpen(true);
                return Promise.resolve();
              },
            }}
            labelKey={p.labelKey}
          />
          <Dialog
            title={text(p.titleKey ?? p.labelKey)}
            description={text(p.descriptionKey, 'components.dialogDescription')}
            open={open}
            onOpenChange={setOpen}
          >
            {component.children}
          </Dialog>
        </>
      );
      break;
    case 'divider':
      content = <hr className="vc-divider" />;
      break;
    case 'spacer':
      content = <span className="vc-spacer" data-size={p.size} aria-hidden />;
      break;
    default:
      content = (
        <>
          {p.titleKey && <h2>{text(p.titleKey)}</h2>}
          {p.descriptionKey && <p className="vb-description">{text(p.descriptionKey)}</p>}
          {component.children}
        </>
      );
  }
  return (
    <Box
      {...component}
      props={{
        as: component.node.type === 'section' ? 'section' : 'div',
        gap: p.gap,
        ...(component.node.type === 'card'
          ? { background: 'surface', border: true, padding: 'md' }
          : {}),
        ...(component.node.type === 'columns' ? { grid: p.columns } : {}),
      }}
    >
      {content}
    </Box>
  );
}
