import { createContext, useContext, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Box, Button, useRuntimePaths, type RendererProps } from '@verbis/core-runtime';
import type { ActionInput, JsonValue } from '@verbis/script-schema';

import { readPath } from './environment.js';
import { isSecureInput } from './secure-input-types.js';

export interface ItemScope {
  item: JsonValue;
  index: number;
  update: (path: string, value: JsonValue) => void;
}
export const ItemContext = createContext<ItemScope | null>(null);
export function useLabels(component: RendererProps) {
  const { t } = useTranslation();
  const text = (key: string | undefined, fallback = 'components.field'): string => {
    const resolved = key ?? fallback;
    return resolved.startsWith('components.') || resolved.startsWith('runtime.')
      ? t(resolved)
      : component.runtime.message(
          resolved,
          component.props['params'] &&
            typeof component.props['params'] === 'object' &&
            !Array.isArray(component.props['params'])
            ? (component.props['params'] as Record<string, JsonValue>)
            : {},
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
    if (scope && itemPath) scope.update(itemPath, next);
    else {
      const binding = component.node.bindings.find((b) => b.prop === prop && 'variable' in b);
      if (binding && 'variable' in binding) {
        const secure = isSecureInput(component.node.type);
        if (secure)
          component.runtime.store.setVariable(
            binding.variable,
            next,
            component.node.type === 'creditCardInput' ? 'pci' : 'pii',
          );
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
