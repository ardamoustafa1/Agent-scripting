import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { Tree } from './tree.js';

const nodes = [
  { id: 'parent', label: 'Parent', children: [{ id: 'child', label: 'Child' }] },
  { id: 'disabled', label: 'Disabled', disabled: true },
  { id: 'other', label: 'Other' },
];
it.each(['ltr', 'rtl'] as const)(
  'supports the complete %s tree keyboard protocol and skips disabled nodes',
  (direction) => {
    const select = vi.fn();
    render(<Tree label="Folders" nodes={nodes} onSelect={select} direction={direction} />);
    const parent = screen.getByRole('treeitem', { name: 'Parent' }),
      other = screen.getByRole('treeitem', { name: 'Other' });
    const expand = direction === 'ltr' ? 'ArrowRight' : 'ArrowLeft',
      collapse = direction === 'ltr' ? 'ArrowLeft' : 'ArrowRight';
    parent.focus();
    fireEvent.keyDown(parent, { key: expand });
    expect(parent.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(parent, { key: expand });
    const child = screen.getByRole('treeitem', { name: 'Child' });
    expect(document.activeElement).toBe(child);
    fireEvent.keyDown(child, { key: collapse });
    expect(document.activeElement).toBe(parent);
    fireEvent.keyDown(parent, { key: collapse });
    expect(parent.getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(parent, { key: collapse });
    expect(document.activeElement).toBe(parent);
    fireEvent.keyDown(parent, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(other);
    fireEvent.keyDown(other, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(other);
    fireEvent.keyDown(other, { key: 'Home' });
    expect(document.activeElement).toBe(parent);
    fireEvent.keyDown(parent, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(parent);
    fireEvent.keyDown(parent, { key: 'End' });
    expect(document.activeElement).toBe(other);
    fireEvent.keyDown(other, { key: 'p' });
    expect(document.activeElement).toBe(parent);
    fireEvent.keyDown(parent, { key: 'z' });
    expect(document.activeElement).toBe(parent);
    fireEvent.keyDown(parent, { key: 'Enter' });
    fireEvent.keyDown(parent, { key: ' ' });
    expect(select).toHaveBeenNthCalledWith(1, 'parent');
    expect(select).toHaveBeenNthCalledWith(2, 'parent');
    expect(fireEvent.keyDown(parent, { key: 'F1' })).toBe(true);
    expect(fireEvent.keyDown(parent, { key: 'o', ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(parent, { key: 'o', metaKey: true })).toBe(true);
    const disabled = screen.getByRole('treeitem', { name: 'Disabled' });
    fireEvent.click(disabled);
    fireEvent.keyDown(disabled, { key: 'Enter' });
    fireEvent.doubleClick(disabled);
    expect(select).toHaveBeenCalledTimes(2);
    fireEvent.click(other);
    expect(select).toHaveBeenLastCalledWith('other');
    fireEvent.doubleClick(other);
    expect(screen.queryByRole('treeitem', { name: 'Child' })).toBeNull();
    fireEvent.doubleClick(parent);
    expect(screen.getByRole('treeitem', { name: 'Child' })).toBeDefined();
    fireEvent.doubleClick(parent);
    expect(screen.queryByRole('treeitem', { name: 'Child' })).toBeNull();
  },
);
it('renders empty and entirely disabled trees without a tab stop', () => {
  const view = render(<Tree label="Folders" nodes={[]} onSelect={vi.fn()} />);
  expect(screen.queryByRole('treeitem')).toBeNull();
  view.rerender(
    <Tree
      label="Folders"
      nodes={[{ id: 'disabled', label: 'Disabled', disabled: true }]}
      selectedId="gone"
      onSelect={vi.fn()}
    />,
  );
  expect(screen.getByRole('treeitem').getAttribute('tabindex')).toBe('-1');
});
