import type { EditorStore } from './store.js';
import type { Announcements, ScreenReaderInstructions } from '@dnd-kit/core';
import type { useTranslation } from 'react-i18next';

type Id = string | number;
type TFunction = ReturnType<typeof useTranslation>['t'];

/** D-07: human names for dnd-kit ids (`palette:<type>`, `node:<id>`, `layer:<id>`, `canvas`). */
export function dragLabel(id: Id, store: EditorStore, t: TFunction): string {
  const value = String(id);
  const component = (type: string | undefined) =>
    type
      ? t(`designer.editor.componentNames.${type}`, { defaultValue: type })
      : t('designer.editor.dnd.item');
  if (value.startsWith('palette:')) return component(value.slice('palette:'.length));
  if (value === 'canvas') return t('designer.editor.canvas');
  const nodeId =
    value === 'canvas-selection'
      ? store.getSnapshot().selection[0]
      : value.replace(/^(node|layer):/, '');
  return component(nodeId ? store.node(nodeId)?.type : undefined);
}
export function dragAnnouncements(store: EditorStore, t: TFunction): Required<Announcements> {
  const name = (id: Id) => dragLabel(id, store, t);
  return {
    onDragStart: ({ active }) => t('designer.editor.dnd.picked', { name: name(active.id) }),
    onDragMove: () => undefined,
    onDragOver: ({ active, over }) =>
      over
        ? t('designer.editor.dnd.over', { name: name(active.id), target: name(over.id) })
        : t('designer.editor.dnd.outside', { name: name(active.id) }),
    onDragEnd: ({ active, over }) =>
      over
        ? t('designer.editor.dnd.dropped', { name: name(active.id), target: name(over.id) })
        : t('designer.editor.dnd.cancelled', { name: name(active.id) }),
    onDragCancel: ({ active }) => t('designer.editor.dnd.cancelled', { name: name(active.id) }),
  };
}
export const dragInstructions = (t: TFunction): ScreenReaderInstructions => ({
  draggable: t('designer.editor.dnd.instructions'),
});
