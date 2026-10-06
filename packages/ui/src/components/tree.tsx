import { ChevronRight, File, Folder } from 'lucide-react';
import { Direction } from 'radix-ui';
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';

export interface TreeNode {
  id: string;
  label: string;
  children?: readonly TreeNode[];
  disabled?: boolean;
}
export interface TreeProps {
  label: string;
  nodes: readonly TreeNode[];
  selectedId?: string;
  onSelect: (id: string) => void;
  defaultExpanded?: readonly string[];
  direction?: 'ltr' | 'rtl';
}
interface VisibleNode {
  node: TreeNode;
  parent?: string;
  level: number;
  pos: number;
  count: number;
}
export function Tree({
  label,
  nodes,
  selectedId,
  onSelect,
  defaultExpanded = [],
  direction,
}: TreeProps) {
  const resolvedDirection = Direction.useDirection(direction);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(defaultExpanded));
  const [focused, setFocused] = useState<string | undefined>(selectedId);
  const visible = useMemo(() => {
    const result: VisibleNode[] = [];
    const walk = (items: readonly TreeNode[], level: number, parent?: string) => {
      items.forEach((node, index) => {
        result.push({
          node,
          level,
          pos: index + 1,
          count: items.length,
          ...(parent === undefined ? {} : { parent }),
        });
        if (node.children && expanded.has(node.id)) walk(node.children, level + 1, node.id);
      });
    };
    walk(nodes, 1);
    return result;
  }, [nodes, expanded]);
  const focusable = visible.filter((item) => !item.node.disabled);
  const tabStop = focusable.some((item) => item.node.id === focused)
    ? focused
    : focusable[0]?.node.id;
  const focus = (target: string | undefined) => {
    if (target === undefined) return;
    setFocused(target);
    root.current?.querySelectorAll<HTMLElement>('[role="treeitem"]').forEach((element) => {
      if (element.dataset['nodeId'] === target) element.focus();
    });
  };
  const toggle = (node: TreeNode) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      return next;
    });
  };
  const key = (event: KeyboardEvent, item: VisibleNode) => {
    const index = focusable.findIndex((entry) => entry.node.id === item.node.id);
    const expandKey = resolvedDirection === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    const collapseKey = resolvedDirection === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
    if (event.key === 'ArrowDown')
      focus(focusable[Math.min(index + 1, focusable.length - 1)]?.node.id);
    else if (event.key === 'ArrowUp') focus(focusable[Math.max(index - 1, 0)]?.node.id);
    else if (event.key === 'Home') focus(focusable[0]?.node.id);
    else if (event.key === 'End') focus(focusable.at(-1)?.node.id);
    else if (event.key === expandKey && item.node.children?.length) {
      if (!expanded.has(item.node.id)) toggle(item.node);
      else focus(focusable[index + 1]?.node.id);
    } else if (event.key === collapseKey) {
      if (expanded.has(item.node.id)) toggle(item.node);
      else focus(item.parent);
    } else if (event.key === 'Enter' || event.key === ' ') {
      onSelect(item.node.id);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      const ordered = [...focusable.slice(index + 1), ...focusable.slice(0, index + 1)];
      focus(
        ordered.find((entry) =>
          entry.node.label.toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()),
        )?.node.id,
      );
    } else return;
    event.preventDefault();
  };
  return (
    <div className="vb-tree" role="tree" aria-label={label} ref={root} dir={resolvedDirection}>
      {visible.map((item, index) => (
        <div
          key={item.node.id}
          id={`${id}-${index}`}
          data-node-id={item.node.id}
          role="treeitem"
          aria-level={item.level}
          aria-posinset={item.pos}
          aria-setsize={item.count}
          aria-selected={selectedId === item.node.id}
          aria-expanded={item.node.children?.length ? expanded.has(item.node.id) : undefined}
          aria-disabled={item.node.disabled ? true : undefined}
          tabIndex={tabStop === item.node.id ? 0 : -1}
          className="vb-tree-item"
          style={{ paddingInlineStart: `calc(var(--vb-space-3) + ${(item.level - 1) * 20}px)` }}
          onFocus={() => {
            setFocused(item.node.id);
          }}
          onKeyDown={(event) => {
            if (!item.node.disabled) key(event, item);
          }}
          onClick={() => {
            if (!item.node.disabled) {
              focus(item.node.id);
              onSelect(item.node.id);
            }
          }}
          onDoubleClick={() => {
            if (!item.node.disabled && item.node.children?.length) toggle(item.node);
          }}
        >
          {item.node.children?.length ? (
            <ChevronRight
              aria-hidden
              size={14}
              className="vb-tree-chevron"
              data-expanded={expanded.has(item.node.id)}
            />
          ) : (
            <span className="vb-tree-spacer" />
          )}
          {item.node.children?.length ? (
            <Folder aria-hidden size={16} />
          ) : (
            <File aria-hidden size={16} />
          )}
          <span>{item.node.label}</span>
        </div>
      ))}
    </div>
  );
}
