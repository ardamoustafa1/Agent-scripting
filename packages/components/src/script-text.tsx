import { createElement, useContext, useState } from 'react';

import { useRuntimePaths, RuntimeProblem, type RendererProps } from '@verbis/core-runtime';
import { Alert, Checkbox, Badge, SafeRichText, escapeTemplateValue } from '@verbis/ui';

import { display, readPath, safeAssetUrl, useComponentEnvironment } from './environment.js';
import { TextSchema } from './schemas.js';
import { Frame, CoreAction, ItemContext, useLabels } from './shared.js';

export function templateDependencies(source: string): string[] {
  return [...source.matchAll(/\{\{\s*((?:vars\.)?[a-zA-Z][a-zA-Z0-9_.]*)\s*\}\}/g)]
    .map((match) =>
      (match[1] ?? '').startsWith('item.')
        ? ''
        : (match[1] ?? '').startsWith('vars.')
          ? (match[1] ?? '')
          : `vars.${match[1] ?? ''}`,
    )
    .filter(Boolean);
}
export function interpolateText(
  source: string,
  component: RendererProps,
  item?: unknown,
  escape = false,
): string {
  if (source.length > 16384) throw new RuntimeProblem('VERBIS_TEMPLATE_LIMIT');
  return source.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_.]*)\s*\}\}/g, (_match, path: string) => {
    // Empty values stay visible as `[path]` (M-Z6/D-10) instead of collapsing the sentence.
    const format = (value: unknown) => {
      const shown = display(value).trim() === '' ? `[${path}]` : display(value);
      return escape ? escapeTemplateValue(shown) : shown;
    };
    if (path.startsWith('item.')) return format(readPath(item, path.slice(5)));
    const variablePath = path.startsWith('vars.') ? path.slice(5) : path;
    const [key, ...rest] = variablePath.split('.');
    if (!key || component.runtime.store.classification(key) === 'pci')
      throw new RuntimeProblem('VERBIS_SENSITIVE_DISPLAY');
    const value = component.runtime.store.variable(key);
    return format(rest.length ? readPath(value, rest.join('.')) : value);
  });
}
export function ScriptContent(component: RendererProps) {
  const p = TextSchema.parse(component.props),
    { text, t } = useLabels(component),
    environment = useComponentEnvironment(),
    scope = useContext(ItemContext);
  const raw = (key: string) =>
    component.runtime.document.i18n.messages[component.runtime.store.locale]?.[key] ??
    component.runtime.document.i18n.messages[component.runtime.document.i18n.defaultLocale]?.[
      key
    ] ??
    text(key);
  const sources = [raw(p.textKey), ...p.blocks.map((block) => raw(block.textKey))];
  useRuntimePaths(component.runtime, [
    ...sources.flatMap(templateDependencies),
    `runtime.read.${component.node.id}`,
  ]);
  const [selected, setSelected] = useState('');
  const content = (key: string) => {
    const source = raw(key);
    if (component.node.type === 'richContent')
      return (
        <SafeRichText
          source={
            source.includes('{{') ? interpolateText(source, component, scope?.item, true) : source
          }
        />
      );
    // Structured blocks are text nodes: React escapes all interpolated values.
    return source.includes('{{') ? interpolateText(source, component, scope?.item) : text(key);
  };
  let result;
  switch (component.node.type) {
    case 'callout':
    case 'alert':
      result = (
        <Alert title={text(p.titleKey ?? p.labelKey)} tone={p.tone}>
          {content(p.textKey)}
        </Alert>
      );
      break;
    case 'checklist': {
      const values = p.value;
      result = (
        <fieldset disabled={!component.enabled || p.disabled}>
          <legend>{text(p.labelKey)}</legend>
          {p.options.map((option) => (
            <Checkbox
              key={option.value}
              label={text(option.labelKey)}
              checked={values.includes(option.value)}
              onCheckedChange={(checked) => {
                if (component.node.bindings.some((b) => b.prop === 'value'))
                  component.write(
                    'value',
                    checked ? [...values, option.value] : values.filter((v) => v !== option.value),
                  );
                void component.emit('onChange').catch(() => undefined);
              }}
            />
          ))}
        </fieldset>
      );
      break;
    }
    case 'objectionHandler':
      result = (
        <>
          <p>{text(p.labelKey)}</p>
          {p.options.map((option) => (
            <CoreAction
              key={option.value}
              component={{
                ...component,
                node: { ...component.node, id: `${component.node.id}-${option.value}` },
                emit: async () => {
                  setSelected(option.value);
                  if (option.page) await component.runtime.navigate(option.page);
                  await component.emit('onPress');
                },
              }}
              labelKey={option.labelKey}
            />
          ))}
          {selected && (
            <Alert title={text(p.labelKey)}>
              {text(p.options.find((o) => o.value === selected)?.responseKey)}
            </Alert>
          )}
        </>
      );
      break;
    case 'knowledgeLink':
      result = p.url ? (
        <a
          href={safeAssetUrl(p.url, environment.knowledgeOrigins)}
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
          className="vc-link"
        >
          {text(p.labelKey)}
        </a>
      ) : (
        <Alert title={t('components.unconfigured')} />
      );
      break;
    case 'heading':
      result = <h2>{content(p.textKey)}</h2>;
      break;
    default:
      result = (
        <div className="vc-script" data-emphasis={p.emphasis}>
          {p.blocks.length ? (
            p.blocks.map((block, index) =>
              block.tag === 'li'
                ? createElement(
                    'ul',
                    { key: index },
                    createElement('li', {}, content(block.textKey)),
                  )
                : createElement(block.tag, { key: index }, content(block.textKey)),
            )
          ) : (
            <p>{content(p.textKey)}</p>
          )}
          {p.mustRead && (
            <>
              <Badge tone="warning">{t('components.mustRead')}</Badge>
              <Checkbox
                label={t('components.readConfirmed')}
                disabled={!component.enabled || p.disabled}
                checked={
                  p.acknowledged ||
                  component.runtime.store.get(`runtime.read.${component.node.id}`) === true
                }
                onCheckedChange={(checked) => {
                  component.runtime.recordInput({
                    type: 'read',
                    node: component.node.id,
                    acknowledged: checked === true,
                  });
                  component.runtime.store.set(
                    `runtime.read.${component.node.id}`,
                    checked === true,
                  );
                  if (component.node.bindings.some((b) => b.prop === 'acknowledged'))
                    component.write('acknowledged', checked === true);
                  void component.emit('onRead').catch(() => undefined);
                }}
              />
            </>
          )}
        </div>
      );
  }
  return <Frame component={component}>{result}</Frame>;
}
