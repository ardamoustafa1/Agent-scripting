import { ArrowRight, Check, Search, Send, Link } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { extractDependencies } from '@verbis/expr';
import { ConditionSchema, SpaceTokenSchema, StylePropsSchema } from '@verbis/script-schema';
import { Button as UiButton, Dialog, Alert, Skeleton } from '@verbis/ui';

import { RuntimeProblem } from './problem.js';
import { ComponentRegistry } from './registry.js';
import { responsiveStyle } from './styles.js';

import type { RendererProps } from './registry.js';

export const BoxPropsSchema = z.strictObject({
  as: z
    .enum(['div', 'section', 'article', 'main', 'aside', 'nav', 'header', 'footer'])
    .default('div'),
  role: z.enum(['region', 'group', 'presentation']).optional(),
  direction: z.enum(['row', 'column']).default('column'),
  gap: SpaceTokenSchema.default('none'),
  padding: SpaceTokenSchema.default('none'),
  grid: z.number().int().min(1).max(12).optional(),
  wrap: z.boolean().default(false),
  scroll: z.boolean().default(false),
  align: StylePropsSchema.shape.align,
  justify: StylePropsSchema.shape.justify,
  border: z.boolean().default(false),
  background: z.enum(['none', 'surface', 'raised']).default('none'),
});
export const ButtonPropsSchema = z.strictObject({
  labelKey: z.string().default('runtime.execute'),
  iconKey: z.enum(['next', 'check', 'search', 'submit', 'link']).optional(),
  variant: z.enum(['primary', 'secondary', 'ghost', 'danger']).default('primary'),
  size: z.enum(['sm', 'md', 'lg']).default('md'),
  loading: z.boolean().default(false),
  disabled: z.boolean().default(false),
  confirm: z.strictObject({ titleKey: z.string(), descriptionKey: z.string() }).optional(),
});
export const WebServicePropsSchema = z.strictObject({
  ds: z.string().default(''),
  trigger: z
    .enum(['manual', 'onLoad', 'onEnter', 'onEvent', 'onChange', 'interval'])
    .default('manual'),
  visible: z.boolean().default(false),
  debounceMs: z.number().int().min(0).max(30_000).default(300),
  intervalMs: z.number().int().min(1000).max(3_600_000).default(30_000),
  watch: z.array(z.string().min(1).max(2000)).max(32).default([]),
  emptyWhen: ConditionSchema.optional(),
});
export function Box({ node, props, runtime, children }: RendererProps) {
  const p = BoxPropsSchema.parse(props),
    Tag = p.as;
  const base = {
    display: p.grid === undefined ? ('flex' as const) : ('grid' as const),
    direction: p.direction,
    gap: p.gap,
    padding: p.padding,
    wrap: p.wrap,
    scroll: p.scroll,
    ...(p.grid === undefined ? {} : { columns: p.grid }),
    ...(p.align === undefined ? {} : { align: p.align }),
    ...(p.justify === undefined ? {} : { justify: p.justify }),
    ...node.style?.base,
  };
  return (
    <Tag
      id={node.id}
      className="vr-box"
      style={responsiveStyle({ ...node.style, base })}
      data-border={p.border}
      data-background={p.background}
      {...(p.role === undefined ? {} : { role: p.role })}
      {...(node.a11y?.labelKey ? { 'aria-label': runtime.message(node.a11y.labelKey) } : {})}
    >
      {children}
    </Tag>
  );
}
export function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.split('+'),
    key = parts.pop();
  return (
    event.key.toLowerCase() === key?.toLowerCase() &&
    event.ctrlKey === parts.includes('Ctrl') &&
    event.altKey === parts.includes('Alt') &&
    event.shiftKey === parts.includes('Shift') &&
    event.metaKey === parts.includes('Meta')
  );
}
export function Button({ node, props, runtime, enabled, emit }: RendererProps) {
  const p = ButtonPropsSchema.parse(props),
    { t } = useTranslation();
  const [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false),
    [failed, setFailed] = useState(false);
  const locked = useRef(false),
    mounted = useRef(true);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const invoke = useCallback(async () => {
    if (locked.current || !enabled || p.disabled || p.loading) return;
    locked.current = true;
    setBusy(true);
    setFailed(false);
    setConfirm(false);
    // The node event controller is owned by the renderer and cancels on unmount.
    try {
      await emit('onPress');
    } catch {
      if (mounted.current) setFailed(true);
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [emit, enabled, p.disabled, p.loading]);
  const press = useCallback(() => {
    if (p.confirm) setConfirm(true);
    else void invoke();
  }, [invoke, p.confirm]);
  useEffect(() => {
    if (!node.a11y?.shortcut) return;
    const shortcut = node.a11y.shortcut;
    const listener = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.repeat ||
        event.isComposing ||
        event.defaultPrevented ||
        (target &&
          'closest' in target &&
          typeof target.closest === 'function' &&
          (target as Element).closest(
            'input,textarea,select,[contenteditable="true"],[role="dialog"]',
          ))
      )
        return;
      if (
        enabled &&
        !p.disabled &&
        !p.loading &&
        !locked.current &&
        matchesShortcut(event, shortcut)
      ) {
        event.preventDefault();
        press();
      }
    };
    const targetDocument = buttonRef.current?.ownerDocument ?? document;
    targetDocument.addEventListener('keydown', listener);
    return () => {
      targetDocument.removeEventListener('keydown', listener);
    };
  }, [node.a11y?.shortcut, press, enabled, p.disabled, p.loading]);
  const Icon = p.iconKey
    ? { next: ArrowRight, check: Check, search: Search, submit: Send, link: Link }[p.iconKey]
    : undefined;
  const label =
    p.labelKey.startsWith('runtime.') || p.labelKey.startsWith('components.')
      ? t(p.labelKey)
      : runtime.message(p.labelKey);
  return (
    <>
      <UiButton
        ref={buttonRef}
        id={node.id}
        variant={p.variant}
        size={p.size}
        disabled={!enabled || p.disabled}
        loading={busy || p.loading}
        onClick={press}
        startIcon={Icon ? <Icon size={16} aria-hidden /> : undefined}
        aria-keyshortcuts={node.a11y?.shortcut?.replace('Ctrl+', 'Control+')}
        aria-label={node.a11y?.labelKey ? runtime.message(node.a11y.labelKey) : undefined}
      >
        {label}
      </UiButton>
      {failed && <Alert tone="danger" title={t('runtime.error')} />}
      {p.confirm && (
        <Dialog
          open={confirm}
          onOpenChange={setConfirm}
          title={runtime.message(p.confirm.titleKey)}
          description={runtime.message(p.confirm.descriptionKey)}
          footer={
            <>
              <UiButton
                variant="secondary"
                onClick={() => {
                  setConfirm(false);
                }}
              >
                {t('runtime.cancel')}
              </UiButton>
              <UiButton onClick={() => void invoke()}>{t('runtime.confirm')}</UiButton>
            </>
          }
        >
          {null}
        </Dialog>
      )}
    </>
  );
}
export function WebService({ node, props, runtime, enabled, emit, children }: RendererProps) {
  const p = WebServicePropsSchema.parse(props),
    { t } = useTranslation();
  const watchKey = JSON.stringify(p.watch);
  const watch = useMemo(() => z.array(z.string()).parse(JSON.parse(watchKey)), [watchKey]);
  const controller = useRef<AbortController | null>(null),
    request = useRef(0);
  const state = runtime.store.get(`ds.${p.ds}`);
  const status =
    state !== null && typeof state === 'object' && !Array.isArray(state) ? state['status'] : 'idle';
  const run = useCallback(async () => {
    if (!enabled) return;
    const generation = ++request.current;
    controller.current?.abort();
    controller.current = new AbortController();
    try {
      await runtime.executor.execute(
        [{ type: 'callDataSource', dataSource: p.ds }],
        controller.current.signal,
        `ui:source:${node.id}`,
      );
      if (generation === request.current) await emit('onSuccess');
    } catch (error) {
      if (
        generation === request.current &&
        !(error instanceof RuntimeProblem && error.code === 'VERBIS_RUNTIME_CANCELLED')
      )
        await emit('onError');
    }
  }, [runtime, p.ds, enabled, emit, node.id]);
  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let interval: ReturnType<typeof setInterval> | undefined;
    let unsubscribe: (() => void) | undefined;
    const schedule = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => void run().catch(() => undefined), p.debounceMs);
    };
    if (p.trigger === 'onLoad' || p.trigger === 'onEnter') void run().catch(() => undefined);
    if (p.trigger === 'onChange')
      unsubscribe = runtime.store.subscribe(
        watch.flatMap((source) => extractDependencies(source)),
        () => {
          if (runtime.store.changeSource !== `dataSource.${p.ds}`) schedule();
        },
      );
    if (p.trigger === 'onEvent')
      unsubscribe = runtime.store.subscribe([`runtime.request.${node.id}`], schedule);
    if (p.trigger === 'interval')
      interval = setInterval(() => void run().catch(() => undefined), p.intervalMs);
    return () => {
      controller.current?.abort();
      clearTimeout(debounce);
      clearInterval(interval);
      unsubscribe?.();
    };
  }, [node.id, p.trigger, p.debounceMs, p.intervalMs, p.ds, watch, run, runtime]);
  if (!p.visible) return null;
  let content: ReactNode = children;
  if (status === 'loading') content = <Skeleton label={t('runtime.loading')} />;
  if (status === 'error')
    content = (
      <Alert tone="danger" title={t('runtime.dataError')}>
        <UiButton onClick={() => void run().catch(() => undefined)} disabled={!enabled}>
          {t('runtime.retry')}
        </UiButton>
      </Alert>
    );
  if (status === 'success' && p.emptyWhen && runtime.condition(p.emptyWhen))
    content = <Alert title={t('runtime.empty')} />;
  return (
    <div id={node.id} aria-busy={status === 'loading'}>
      {content}
      {p.trigger === 'manual' && (
        <UiButton
          onClick={() => void run().catch(() => undefined)}
          disabled={!enabled}
          loading={status === 'loading'}
        >
          {t('runtime.execute')}
        </UiButton>
      )}
    </div>
  );
}
const meta = (icon: string, acceptsChildren: readonly string[] | '*') => ({
  icon,
  category: 'core',
  acceptsChildren,
  allowedParents: '*' as const,
  draggable: true,
});
export function createCoreRegistry(): ComponentRegistry {
  return new ComponentRegistry()
    .register({
      type: 'box',
      renderer: Box,
      propsSchema: BoxPropsSchema,
      defaults: {},
      designerMeta: meta('Square', '*'),
      events: [],
      bindableProps: [
        'direction',
        'gap',
        'padding',
        'grid',
        'wrap',
        'scroll',
        'align',
        'justify',
        'border',
        'background',
      ],
    })
    .register({
      type: 'button',
      renderer: Button,
      propsSchema: ButtonPropsSchema,
      defaults: {},
      designerMeta: meta('MousePointer2', []),
      events: ['onPress'],
      bindableProps: ['labelKey', 'iconKey', 'disabled', 'loading', 'variant'],
    })
    .register({
      type: 'webService',
      renderer: WebService,
      propsSchema: WebServicePropsSchema,
      defaults: {},
      designerMeta: meta('Database', []),
      events: ['onSuccess', 'onError'],
      bindableProps: ['visible', 'ds'],
    });
}
