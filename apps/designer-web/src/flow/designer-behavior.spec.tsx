import { createEvent, fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { DataSourceRefSchema, VariableSchema } from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';

import { EditorStore } from '../editor/store.js';
import { mountDesigner } from '../fixtures.spec.helpers.js';

import { FlowDesigner } from './designer.js';
import { createScreenSubflow } from './model.js';

async function setup(readOnly = false) {
  vi.stubGlobal(
    'DOMMatrixReadOnly',
    class {
      m22 = 1;
    },
  );
  Object.defineProperty(SVGElement.prototype, 'getBBox', {
    configurable: true,
    value: () => ({ x: 0, y: 0, width: 100, height: 20 }),
  });
  // jsdom supplies dimensions but has no native ResizeObserver delivery.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback(
          [
            {
              target,
              contentRect: new DOMRect(0, 0, 800, 600),
              borderBoxSize: [{ inlineSize: 800, blockSize: 600 }],
            } as unknown as ResizeObserverEntry,
          ],
          this,
        );
      }
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
  const store = new EditorStore(minimalScript()),
    openPage = vi.fn();
  store.edit((doc) => {
    doc.variables.push(
      VariableSchema.parse({ key: 'synthetic', type: 'string', scope: 'session' }),
    );
    doc.dataSources.push(
      DataSourceRefSchema.parse({
        id: 'synthetic',
        ref: 'tenant-datasource:synthetic',
        version: 1,
      }),
    );
  });
  createScreenSubflow(store, 'home', 'synthetic-subflow');
  const f = await mountDesigner(
    <FlowDesigner
      store={store}
      openPage={openPage}
      readOnly={readOnly}
      trace={{ nodes: new Set(['n-home']), edges: new Set(['e1']), current: 'n-home' }}
    />,
  );
  const select = async (id: string) => {
    const node = await waitFor(() => {
      const element = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`);
      expect(element).toBeTruthy();
      return element!;
    });
    fireEvent.click(node);
    return node;
  };
  return { ...f, store, openPage, select };
}
async function choose(label: string, name: string) {
  fireEvent.click(screen.getByRole('combobox', { name: label }));
  fireEvent.click(await screen.findByRole('option', { name }));
}
it('edits graph positions and opens the page through double click', async () => {
  const f = await setup();
  const node = await f.select('n-home');
  fireEvent.change(await screen.findByLabelText('X'), { target: { value: '125' } });
  fireEvent.change(screen.getByLabelText('Y'), { target: { value: '250' } });
  expect(f.store.getSnapshot().document.flow.nodes[0]).toMatchObject({
    position: { x: 125, y: 250 },
  });
  fireEvent.keyDown(node, { key: 'ArrowRight' });
  expect(f.store.getSnapshot().document.flow.nodes[0]).toMatchObject({
    position: { x: 130, y: 250 },
  });
  fireEvent.doubleClick(node);
  expect(f.openPage).toHaveBeenCalledWith('home');
});
it.each(['decision', 'dataSource', 'setVariable', 'transfer', 'end', 'subflow'])(
  'adds and edits a %s flow node',
  async (type) => {
    const f = await setup();
    fireEvent.click(screen.getByRole('button', { name: f.label(`flow.types.${type}`) }));
    const added = f.store.getSnapshot().document.flow.nodes.at(-1)!;
    expect(added.type).toBe(type);
    await f.select(added.id);
    await screen.findByLabelText('X');
    if (type === 'transfer') {
      fireEvent.change(screen.getByLabelText(f.label('flow.target')), {
        target: { value: 'synthetic-queue' },
      });
      expect(f.store.getSnapshot().document.flow.nodes.at(-1)).toMatchObject({
        target: 'synthetic-queue',
      });
    }
    if (type === 'end') {
      for (const field of ['outcome', 'disposition']) {
        fireEvent.change(screen.getByLabelText(f.label(`flow.${field}`)), {
          target: { value: 'SYNTHETIC' },
        });
        fireEvent.change(screen.getByLabelText(f.label(`flow.${field}`)), {
          target: { value: '' },
        });
      }
    }
    if (type === 'setVariable') {
      const input = screen.getByLabelText(f.label('rules.value'));
      fireEvent.change(input, { target: { value: '"synthetic-value"' } });
      fireEvent.blur(input);
      expect(f.store.getSnapshot().document.flow.nodes.at(-1)).toMatchObject({
        value: 'synthetic-value',
      });
    }
    if (type !== 'end') {
      await choose(f.label('flow.connectTarget'), 'n-end');
      if (type === 'decision') await choose(f.label('flow.condition'), f.label('flow.else'));
      if (type === 'dataSource') await choose(f.label('flow.condition'), f.label('flow.error'));
      fireEvent.click(screen.getByRole('button', { name: f.label('flow.connect') }));
      expect(f.store.getSnapshot().document.flow.edges.at(-1)).toMatchObject({
        from: added.id,
        to: 'n-end',
        ...(type === 'decision' ? { default: true } : {}),
        ...(type === 'dataSource' ? { port: 'error' } : {}),
      });
    }
    fireEvent.click(screen.getByRole('button', { name: f.label('editor.delete') }));
    expect(f.store.getSnapshot().document.flow.nodes.some((node) => node.id === added.id)).toBe(
      false,
    );
  },
);
it('adds and edits graph annotations and preserves the start node', async () => {
  const f = await setup();
  fireEvent.click(screen.getByRole('button', { name: f.label('flow.note') }));
  const note = f.store.getSnapshot().document.flow.designer!.notes[0]!;
  await f.select(note.id);
  fireEvent.change(await screen.findByLabelText(f.label('flow.note')), {
    target: { value: 'Synthetic annotation' },
  });
  expect(f.store.getSnapshot().document.flow.designer!.notes[0]!.text).toBe('Synthetic annotation');
  fireEvent.click(screen.getByRole('button', { name: f.label('editor.delete') }));
  expect(f.store.getSnapshot().document.flow.designer!.notes).toHaveLength(0);
  await f.select('n-home');
  fireEvent.click(screen.getByRole('button', { name: f.label('editor.delete') }));
  expect(f.store.getSnapshot().message).toBe('designer.editor.operationFailed');
  expect(f.store.getSnapshot().document.flow.nodes.some((node) => node.id === 'n-home')).toBe(true);
});
it('lays out the graph using the actual ELK engine and switches embedded subflows', async () => {
  const f = await setup();
  fireEvent.click(screen.getByRole('button', { name: f.label('flow.layout') }));
  await waitFor(
    () => {
      expect(f.store.getSnapshot().document.flow.nodes.every((node) => node.position)).toBe(true);
    },
    { timeout: 5000 },
  );
  await choose(f.label('flow.title'), 'Home');
  expect(await f.select('synthetic-subflow-page')).toBeTruthy();
  expect(f.store.getSnapshot().document.subflows[0]!.nodes).toHaveLength(2);
});
it('disables graph mutations on read-only versions', async () => {
  const f = await setup(true);
  const before = f.store.getSnapshot().document;
  const node = await f.select('n-home');
  fireEvent.keyDown(node, { key: 'ArrowRight' });
  expect(
    screen.getByRole('button', { name: f.label('flow.layout') }).hasAttribute('disabled'),
  ).toBe(true);
  expect(f.store.getSnapshot().document).toBe(before);
});
it('groups selected nodes, edits the group label, moves members and ungroups', async () => {
  const f = await setup();
  const home = await f.select('n-home');
  const end = await waitFor(() => {
    const node = document.querySelector<HTMLElement>('.react-flow__node[data-id="n-end"]');
    expect(node).toBeTruthy();
    return node!;
  });
  fireEvent.keyDown(document, { key: 'Control', code: 'ControlLeft' });
  fireEvent.click(end, { ctrlKey: true });
  fireEvent.keyUp(document, { key: 'Control', code: 'ControlLeft' });
  const group = screen.getByRole('button', { name: f.label('flow.group') });
  await waitFor(() => {
    expect(group.hasAttribute('disabled')).toBe(false);
  });
  fireEvent.click(group);
  const created = f.store.getSnapshot().document.flow.designer!.groups[0]!;
  expect([...created.nodes].sort()).toEqual(['n-end', 'n-home']);
  const groupNode = await f.select(created.id);
  fireEvent.change(await screen.findByLabelText(f.label('flow.group')), {
    target: { value: 'Synthetic group' },
  });
  expect(f.store.getSnapshot().document.flow.designer!.groups[0]!.label).toBe('Synthetic group');
  fireEvent.keyDown(groupNode, { key: 'ArrowRight' });
  expect(
    f.store.getSnapshot().document.flow.nodes.every((node) => node.position !== undefined),
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: f.label('editor.ungroup') }));
  expect(f.store.getSnapshot().document.flow.designer!.groups).toHaveLength(0);
  expect(home).toBeTruthy();
});
it('edits edge iteration guards, attaches a rule and deletes the selected edge', async () => {
  const f = await setup();
  const edge = await waitFor(() => {
    const element = document.querySelector<SVGGElement>(
      '.react-flow__edge[data-testid="rf__edge-e1"]',
    );
    expect(element).toBeTruthy();
    return element!;
  });
  fireEvent.click(edge);
  const iterations = await screen.findByLabelText(f.label('flow.iterations'));
  fireEvent.change(iterations, { target: { value: '3' } });
  expect(f.store.getSnapshot().document.flow.edges[0]!.maxIterations).toBe(3);
  fireEvent.change(iterations, { target: { value: '' } });
  expect(f.store.getSnapshot().document.flow.edges[0]!.maxIterations).toBeUndefined();
  fireEvent.click(screen.getAllByRole('button', { name: f.label('rules.addCondition') }).at(-1)!);
  fireEvent.click(screen.getByRole('button', { name: f.label('rules.addCondition') }));
  expect(f.store.getSnapshot().document.flow.edges[0]!.when).toEqual({ $rule: 'rule-e1' });
  expect(f.store.getSnapshot().document.rules.find((rule) => rule.id === 'rule-e1')).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button', { name: f.label('editor.delete') })[0]!);
  expect(f.store.getSnapshot().document.flow.edges).toHaveLength(0);
});
it('changes the flow start and uses keyboard navigation for all position directions', async () => {
  const f = await setup();
  const node = await f.select('n-end');
  fireEvent.click(screen.getByRole('button', { name: f.label('flow.makeStart') }));
  expect(f.store.getSnapshot().document.flow.start).toBe('n-end');
  for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowDown']) fireEvent.keyDown(node, { key });
  expect(
    f.store.getSnapshot().document.flow.nodes.find((item) => item.id === 'n-end')!.position,
  ).toMatchObject({ x: -5, y: 0 });
});

it('moves annotations with the keyboard and commits node positions after dragging', async () => {
  const f = await setup();
  fireEvent.click(screen.getByRole('button', { name: f.label('flow.note') }));
  const note = f.store.getSnapshot().document.flow.designer!.notes[0]!;
  const annotation = await f.select(note.id);
  fireEvent.keyDown(annotation, { key: 'ArrowDown' });
  expect(f.store.getSnapshot().document.flow.designer!.notes[0]!.position.y).toBe(
    note.position.y + 5,
  );
  const node = await f.select('n-end');
  const before = f.store
    .getSnapshot()
    .document.flow.nodes.find((item) => item.id === 'n-end')!.position;
  const mouse = (
    kind: 'mouseDown' | 'mouseMove' | 'mouseUp',
    target: Element | Window,
    x: number,
    y: number,
  ) => {
    const event = createEvent[kind](target, {
      button: 0,
      buttons: kind === 'mouseUp' ? 0 : 1,
      clientX: x,
      clientY: y,
    });
    Object.defineProperty(event, 'view', { value: document.defaultView });
    fireEvent(target, event);
  };
  mouse('mouseDown', node, 100, 100);
  mouse('mouseMove', window, 150, 130);
  mouse('mouseUp', window, 150, 130);
  await waitFor(() => {
    expect(
      f.store.getSnapshot().document.flow.nodes.find((item) => item.id === 'n-end')!.position,
    ).not.toEqual(before);
  });
});

vi.mock('./layout-engine.js', () => ({
  layoutEngine: async () => {
    const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
    return new ELK();
  },
}));
