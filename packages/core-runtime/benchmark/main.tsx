import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { z } from 'zod';

import { createI18n } from '@verbis/i18n';
import { Input, UiProvider } from '@verbis/ui';

import '@verbis/ui/tokens.css';

import { runtimeFixture } from '../src/fixtures.js';
import { Runtime, ScriptRenderer, createCoreRegistry, type RendererProps } from '../src/index.js';

const i18n = await createI18n();
let root: Root | undefined;
let runtime: Runtime | undefined;
let renderCounts: Record<string, number> = {};
let inputDurations: number[] = [];
function rootContainer(): HTMLElement {
  const element = document.getElementById('root');
  if (!element) throw new Error('Benchmark root missing');
  return element;
}
const container = rootContainer();
function Leaf({ node, props, write }: RendererProps) {
  // eslint-disable-next-line react-hooks/immutability -- Deliberate render instrumentation; no application state is mutated.
  renderCounts[node.id] = (renderCounts[node.id] ?? 0) + 1;
  return (
    <Input
      label={node.id}
      id={node.id}
      aria-label={node.id}
      value={String(props['value'])}
      onChange={(event) => {
        const begin = performance.now();
        flushSync(() => {
          write('value', event.target.value);
        });
        // Includes React commit and synchronous style/layout; excludes frame scheduler jitter.
        document.getElementById(node.id)?.getBoundingClientRect();
        inputDurations.push(performance.now() - begin);
      }}
    />
  );
}
async function mount(): Promise<{ initialMs: number; preparationMs: number; nodeCount: number }> {
  root?.unmount();
  runtime?.dispose();
  container.replaceChildren();
  renderCounts = {};
  inputDurations = [];
  const preparationStart = performance.now();
  const registry = createCoreRegistry().register({
    type: 'textInput',
    renderer: Leaf,
    propsSchema: z.strictObject({ value: z.string().default('') }),
    defaults: {},
    designerMeta: {
      icon: 'Text',
      category: 'field',
      acceptsChildren: [],
      allowedParents: '*',
      draggable: true,
    },
    events: [],
    bindableProps: ['value'],
  });
  const doc = runtimeFixture(
    Array.from({ length: 499 }, (_, index) => ({
      id: `field-${index}`,
      type: 'textInput',
      bindings: [{ variable: `value${index}` }],
    })),
  );
  doc.variables.push(
    ...Array.from({ length: 499 }, (_, index) => ({
      key: `value${index}`,
      type: 'string' as const,
      scope: 'session' as const,
      default: '',
      classification: 'public' as const,
      pii: false,
      persist: false,
    })),
  );
  const firstPage = doc.pages[0];
  if (firstPage) firstPage.layout.props['as'] = 'main';
  runtime = new Runtime({ document: doc, registry, ports: { sessionEvent: () => undefined } });
  await runtime.start();
  const engine = runtime;
  const mountedRoot = createRoot(container);
  root = mountedRoot;
  const preparationMs = performance.now() - preparationStart;
  const begin = performance.now();
  flushSync(() => {
    mountedRoot.render(
      <UiProvider i18n={i18n}>
        <ScriptRenderer runtime={engine} autoStart={false} />
      </UiProvider>,
    );
  });
  container.getBoundingClientRect();
  return { initialMs: performance.now() - begin, preparationMs, nodeCount: 500 };
}
const benchmark = {
  mount,
  metrics: () => ({ renderCounts, inputDurations }),
  dispose: () => {
    root?.unmount();
    runtime?.dispose();
  },
};
declare global {
  interface Window {
    runtimeBenchmark: typeof benchmark;
  }
}
window.runtimeBenchmark = benchmark;
