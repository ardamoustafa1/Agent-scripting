import { expect, it } from 'vitest';

import { minimalScript } from '@verbis/script-schema/fixtures';

import { mountDesigner } from '../fixtures.spec.helpers.js';

import { dragAnnouncements, dragLabel } from './drag-a11y.js';
import { EditorStore } from './store.js';

// D-07: drag announcements were English and exposed ids such as `node:node-589ec78e…`.
it('names palette items, canvas selections and layers by their component name', async () => {
  const f = await mountDesigner(<span />);
  const store = new EditorStore(minimalScript());
  const t = f.i18n.t.bind(f.i18n);
  const button = t('designer.editor.componentNames.button');
  expect(dragLabel('palette:rating', store, t)).toBe(t('designer.editor.componentNames.rating'));
  store.select('btn-next');
  expect(dragLabel('canvas-selection', store, t)).toBe(button);
  expect(dragLabel('node:btn-next', store, t)).toBe(button);
  expect(dragLabel('layer:btn-next', store, t)).toBe(button);
  expect(dragLabel('canvas', store, t)).toBe(t('designer.editor.canvas'));
  const announce = dragAnnouncements(store, t);
  const active = { id: 'node:btn-next' } as never,
    over = { id: 'canvas' } as never;
  for (const message of [
    announce.onDragStart({ active }),
    announce.onDragOver({ active, over }),
    announce.onDragEnd({ active, over }),
    announce.onDragCancel({ active, over: null }),
  ]) {
    expect(message).toContain(button);
    expect(message).not.toMatch(/node:|layer:|palette:|draggable|droppable/i);
  }
});
