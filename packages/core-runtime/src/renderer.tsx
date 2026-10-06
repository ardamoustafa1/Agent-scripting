import {
  Component,
  createContext,
  useContext,
  type ComponentType,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

import { extractDependencies } from '@verbis/expr';
import { ConditionSchema, type JsonValue, type Node } from '@verbis/script-schema';
import { Alert, Dialog } from '@verbis/ui';

import { RuntimeProblem } from './problem.js';
import { RUNTIME_STYLES } from './styles.js';

import type { Runtime } from './runtime.js';

export function useRuntimePaths(runtime: Runtime, dependencies: readonly string[]): string {
  const key = dependencies.join('\u0000');
  const paths = useMemo(() => key.split('\u0000').filter(Boolean), [key]);
  const subscribe = useCallback(
    (listener: () => void) => runtime.store.subscribe(paths, listener),
    [runtime, paths],
  );
  const snapshot = useCallback(() => runtime.store.revision(paths), [runtime, paths]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
interface BoundaryProps {
  runtime: Runtime;
  node: string;
  fallback: ReactNode;
  children: ReactNode;
  revision: string;
}
export class NodeErrorBoundary extends Component<BoundaryProps, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidCatch(_error: Error, _info: ErrorInfo): void {
    this.props.runtime.event('component', 'failed', 'VERBIS_COMPONENT_FAILED', this.props.node);
  }
  override componentDidUpdate(previous: BoundaryProps): void {
    if (previous.revision !== this.props.revision && this.state.failed)
      this.setState({ failed: false });
  }
  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
interface NodeProps {
  node: Node;
  runtime: Runtime;
  sourceNode?: Node;
}
const NodeContent = memo(function NodeContent({ node, runtime, sourceNode = node }: NodeProps) {
  const definition = runtime.registry.get(node.type),
    { t } = useTranslation();
  const dependencies = useMemo(() => {
    const deps = [
      'runtime.locale',
      ...runtime.expressions.dependencies(node),
      ...(definition.dependencies?.(node, runtime.document) ?? []),
    ];
    if (node.type === 'webService' && node.bindings.some((binding) => binding.prop === 'ds'))
      deps.push('ds.*');
    if (node.type === 'webService' && node.props['emptyWhen']) {
      const condition = ConditionSchema.parse(node.props['emptyWhen']);
      deps.push(...extractDependencies(runtime.expressions.source(condition)));
    }
    return deps;
  }, [runtime, node, definition]);
  useRuntimePaths(runtime, dependencies);
  const controllers = useRef(new Set<AbortController>());
  useEffect(
    () => () => {
      for (const controller of controllers.current) controller.abort();
    },
    [],
  );
  const emit = useCallback(
    async (event: string) => {
      if (!definition.events.includes(event)) throw new RuntimeProblem('VERBIS_COMPONENT_EVENT');
      const controller = new AbortController();
      controllers.current.add(controller);
      try {
        runtime.recordInput({ type: 'event', node: sourceNode.id, event });
        await runtime.executor.execute(
          node.events[event] ?? [],
          controller.signal,
          `node:${node.id}/${event}`,
        );
      } finally {
        controllers.current.delete(controller);
      }
    },
    [runtime, node, sourceNode, definition],
  );
  const write = useCallback(
    (prop: string, value: JsonValue) => {
      if (!runtime.condition(node.enabledWhen) || !runtime.condition(node.visibleWhen)) return;
      const binding = node.bindings.find((b) => b.prop === prop && 'variable' in b);
      if (!binding || !('variable' in binding)) throw new RuntimeProblem('VERBIS_BINDING_READONLY');
      runtime.store.setVariable(binding.variable, value);
      runtime.recordInput({ type: 'variable', variable: binding.variable, value });
    },
    [runtime, node],
  );
  if (!runtime.condition(node.visibleWhen)) return null;
  const resolved: Record<string, unknown> = { ...definition.defaults, ...node.props };
  for (const binding of node.bindings) {
    if (definition.secureBindings?.includes(binding.prop)) {
      resolved[binding.prop] = '';
      continue;
    }
    if ('variable' in binding) {
      const variable = runtime.document.variables.find((v) => v.key === binding.variable);
      if (variable && runtime.store.classification(variable.key) === 'pci')
        throw new RuntimeProblem('VERBIS_SENSITIVE_DISPLAY');
      resolved[binding.prop] =
        runtime.store.get(`runtime.mask.${node.id}`) === true
          ? ''
          : runtime.store.variable(binding.variable);
    } else {
      runtime.expressions.assertDisplay(binding.expression);
      resolved[binding.prop] =
        runtime.store.get(`runtime.mask.${node.id}`) === true
          ? ''
          : runtime.expressions.evaluate(binding.expression);
    }
  }
  const Renderer = definition.renderer;
  const errors = runtime.store.get(`runtime.errors.${node.id}`);
  return (
    <>
      <Renderer
        node={node}
        sourceNode={sourceNode}
        props={definition.propsSchema.parse(resolved)}
        runtime={runtime}
        enabled={runtime.condition(node.enabledWhen)}
        required={
          node.requiredWhen ? runtime.condition(node.requiredWhen) : node.props['required'] === true
        }
        emit={emit}
        write={write}
      >
        {(definition.ownsChildren ? [] : (node.children ?? [])).map((child, index) => (
          <NodeRenderer
            key={child.id}
            node={child}
            runtime={runtime}
            sourceNode={sourceNode.children?.[index] ?? child}
          />
        ))}
      </Renderer>
      {Array.isArray(errors) && errors.length > 0 && (
        <div id={`${node.id}-errors`} role="alert">
          {errors.map((key, index) => (
            <p key={index}>
              {typeof key === 'string'
                ? key.startsWith('runtime.')
                  ? t(key)
                  : runtime.message(key)
                : ''}
            </p>
          ))}
        </div>
      )}
    </>
  );
});
export interface NodeDecorationProps {
  node: Node;
  children: ReactNode;
}
export const NodeDecorationContext = createContext<ComponentType<NodeDecorationProps> | null>(null);
export const NodeRenderer = memo(function NodeRenderer({
  node,
  runtime,
  sourceNode = node,
}: NodeProps) {
  const { t } = useTranslation();
  // Computation failures are caught inside the boundary, including dependency analysis.
  const revision = useRuntimePaths(runtime, [`runtime.retry.${node.id}`]);
  const Decoration = useContext(NodeDecorationContext);
  const focusedAt = useRef<number | null>(null);
  const content = (
    <div
      data-runtime-node={node.id}
      style={{ display: 'contents' }}
      onFocusCapture={(event) => {
        if (
          node.bindings.length &&
          event.target ===
            event.currentTarget.querySelector('input,textarea,select,[role="combobox"]')
        )
          focusedAt.current = performance.now();
      }}
      onBlurCapture={(event) => {
        if (focusedAt.current !== null) {
          const start = focusedAt.current;
          focusedAt.current = null;
          if (!runtime.simulation)
            runtime.ports.telemetry?.({
              type: 'field.observed',
              name: node.id,
              status: event.target.getAttribute('aria-invalid') === 'true' ? 'failure' : 'success',
              durationMs: Math.min(300000, Math.max(0, Math.round(performance.now() - start))),
            });
        }
      }}
    >
      <NodeErrorBoundary
        runtime={runtime}
        node={node.id}
        revision={revision}
        fallback={<Alert tone="danger" title={t('runtime.componentError')} />}
      >
        <NodeContent node={node} runtime={runtime} sourceNode={sourceNode} />
      </NodeErrorBoundary>
    </div>
  );
  // The host provides a module-level component, not a component factory.
  // eslint-disable-next-line react-hooks/static-components
  return Decoration ? <Decoration node={node}>{content}</Decoration> : content;
});
export interface ScriptRendererProps {
  runtime: Runtime;
  autoStart?: boolean;
  nonce?: string;
}
export function ScriptRenderer({ runtime, autoStart = true, nonce }: ScriptRendererProps) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  useRuntimePaths(runtime, ['runtime.page', 'runtime.modal', 'runtime.ended', 'runtime.locale']);
  useEffect(() => {
    if (autoStart)
      void runtime.start().catch(() => {
        setFailed(true);
      });
  }, [runtime, autoStart, setFailed]);
  const pageId = runtime.store.get('runtime.page'),
    modalId = runtime.store.get('runtime.modal');
  const page = typeof pageId === 'string' ? runtime.page(pageId) : undefined;
  const modal = typeof modalId === 'string' ? runtime.page(modalId) : undefined;
  return (
    <>
      <style nonce={nonce}>{RUNTIME_STYLES}</style>
      {failed && <Alert title={t('runtime.error')} tone="danger" />}
      {page && <NodeRenderer node={page.layout} runtime={runtime} />}
      {modal && (
        <Dialog
          open
          title={modal.titleKey ? runtime.message(modal.titleKey) : t('runtime.dialog')}
          description={t('runtime.dialogDescription')}
          onOpenChange={(open) => {
            if (!open) runtime.store.set('runtime.modal', null);
          }}
        >
          <NodeRenderer node={modal.layout} runtime={runtime} />
        </Dialog>
      )}
    </>
  );
}
