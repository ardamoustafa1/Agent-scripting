import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Box, Button, useRuntimePaths, type RendererProps } from '@verbis/core-runtime';
import type { ActionInput, JsonValue } from '@verbis/script-schema';

import { readPath } from './environment.js';
import { placeholderNames } from './placeholders.js';
import { isPersonalIdInput, isSecureInput } from './secure-input-types.js';

export interface ItemScope {
  item: JsonValue;
  index: number;
  update: (path: string, value: JsonValue) => void;
}
export const ItemContext = createContext<ItemScope | null>(null);
export function useLabels(component: RendererProps) {
  const { t } = useTranslation();
  const { node, runtime } = component;
  // An empty value shows as a named gap the agent can read ("[müşteri adı]"), not as code.
  const gaps = useMemo(
    () => placeholderNames(node, runtime.document, (key) => t(key)),
    [node, runtime.document, t],
  );
  const text = (key: string | undefined, fallback = 'components.field'): string => {
    const resolved = key ?? fallback;
    return resolved.startsWith('components.') || resolved.startsWith('runtime.')
      ? t(resolved)
      : runtime.message(
          resolved,
          component.props['params'] &&
            typeof component.props['params'] === 'object' &&
            !Array.isArray(component.props['params'])
            ? (component.props['params'] as Record<string, JsonValue>)
            : {},
          gaps,
        );
  };
  return { text, t };
}
export function Frame({
  component,
  children,
  card = false,
  columns,
}: {
  component: RendererProps;
  children: ReactNode;
  card?: boolean;
  columns?: number;
}) {
  return (
    <Box
      {...component}
      node={{ ...component.node, id: `${component.node.id}-container` }}
      props={{
        as: 'div',
        gap: 'sm',
        ...(card ? { padding: 'md', border: true, background: 'surface' } : {}),
        ...(columns === undefined ? {} : { grid: columns }),
      }}
    >
      {children}
    </Box>
  );
}
export function CoreAction({
  component,
  labelKey,
  actions,
  children,
}: {
  component: RendererProps;
  labelKey: string;
  actions?: readonly ActionInput[];
  children?: ReactNode;
}) {
  return (
    <Button
      {...component}
      props={{
        labelKey,
        variant: component.props['variant'] ?? 'secondary',
        loading: component.props['loading'] ?? false,
        disabled: component.props['disabled'] ?? false,
        ...(component.props['confirm'] === undefined
          ? {}
          : { confirm: component.props['confirm'] }),
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
    >
      {children}
    </Button>
  );
}
export function useField(component: RendererProps) {
  const scope = useContext(ItemContext),
    { text } = useLabels(component);
  useRuntimePaths(component.runtime, [
    `runtime.errors.${component.node.id}`,
    `runtime.mask.${component.node.id}`,
  ]);
  const errors = component.runtime.store.get(`runtime.errors.${component.node.id}`);
  const first = Array.isArray(errors) && typeof errors[0] === 'string' ? errors[0] : undefined;
  const itemPath =
    typeof component.props['itemPath'] === 'string' ? component.props['itemPath'] : undefined;
  const masked = component.runtime.store.get(`runtime.mask.${component.node.id}`) === true;
  const value = masked
    ? ''
    : scope && itemPath
      ? readPath(scope.item, itemPath)
      : component.props['value'];
  const write = (next: JsonValue, prop = 'value') => {
    if (!component.enabled || component.props['disabled'] === true || masked) return;
    if (scope && itemPath) {
      // Defence in depth: personal IDs must not land in a (possibly public) repeater row.
      if (!isPersonalIdInput(component.node.type)) scope.update(itemPath, next);
    } else {
      const binding = component.node.bindings.find((b) => b.prop === prop && 'variable' in b);
      if (binding && 'variable' in binding) {
        // Card numbers are PCI; TCKN/VKN/IBAN are always personal data (ADR-0053).
        if (isSecureInput(component.node.type))
          component.runtime.store.setVariable(binding.variable, next, 'pci');
        else if (isPersonalIdInput(component.node.type))
          component.runtime.store.setVariable(binding.variable, next, 'pii');
        else component.write(prop, next);
      }
    }
    void component.emit('onChange').catch(() => {
      component.runtime.event('component', 'failed', 'VERBIS_FIELD_EVENT', component.node.id);
    });
  };
  return {
    value,
    write,
    text,
    disabled: !component.enabled || component.props['disabled'] === true || masked,
    label: text(
      typeof component.props['labelKey'] === 'string' ? component.props['labelKey'] : undefined,
    ),
    ...(first === undefined ? {} : { error: text(first) }),
    ...(typeof component.props['hintKey'] === 'string'
      ? { hint: text(component.props['hintKey']) }
      : {}),
    'aria-invalid': first !== undefined,
    'aria-describedby': first === undefined ? undefined : `${component.node.id}-errors`,
    required: component.required,
  };
}
