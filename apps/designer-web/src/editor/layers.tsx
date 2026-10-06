import { useDraggable, useDroppable } from '@dnd-kit/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronRight, ChevronDown, GripVertical } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Input, Button, Tabs, Badge } from '@verbis/ui';

import { findComponents, searchText } from './search.js';
import { editorRegistry, useEditor, type EditorStore } from './store.js';

function PaletteItem({ type, insert }: { type: string; insert: () => void }) {
  const { t } = useTranslation();
  const label = t(`designer.editor.componentNames.${type}`, { defaultValue: type });
  const drag = useDraggable({ id: `palette:${type}`, data: { type } });
  return (
    <div ref={drag.setNodeRef} className="ed-palette-item" data-component-type={type}>
      <button {...drag.listeners} {...drag.attributes} aria-label={label} className="ed-grip">
        <GripVertical size={14} aria-hidden />
      </button>
      <Button variant="ghost" onClick={insert}>
        {label}
      </Button>
    </div>
  );
}
function Layer({
  id,
  depth,
  store,
  collapsed,
  toggle,
  navigate,
}: {
  id: string;
  depth: number;
  store: EditorStore;
  collapsed: boolean;
  toggle: () => void;
  navigate: (delta: number) => void;
}) {
  const { t } = useTranslation();
  const state = useEditor(store);
  const drag = useDraggable({ id: `node:${id}`, data: { nodeId: id } }),
    drop = useDroppable({ id: `layer:${id}`, data: { nodeId: id } });
  const node = store.node(id);
  return (
    <div
      ref={drop.setNodeRef}
      role="treeitem"
      data-layer-id={id}
      aria-level={depth + 1}
      aria-expanded={node?.children?.length ? !collapsed : undefined}
      aria-selected={state.selection.includes(id)}
      className={`ed-layer ${state.selection.includes(id) ? 'is-selected' : ''}`}
      style={{ paddingInlineStart: depth * 16 }}
    >
      <button
        ref={drag.setNodeRef}
        {...drag.attributes}
        {...drag.listeners}
        className="ed-grip"
        aria-label={id}
      >
        <GripVertical size={14} aria-hidden />
      </button>
      {node?.children?.length ? (
        <button className="ed-grip" aria-label={node.id} onClick={toggle}>
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
      ) : null}
      <button
        onClick={(e) => {
          store.select(id, e.shiftKey);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (e.altKey) {
              const l = store.location(id);
              if (l?.parent)
                store.execute(() => {
                  store.move(
                    id,
                    l.parent?.id ?? '',
                    Math.max(0, (l.index ?? 0) + (e.key === 'ArrowDown' ? 1 : -1)),
                  );
                });
            } else navigate(e.key === 'ArrowDown' ? 1 : -1);
          }
          if (e.key === 'ArrowRight' && collapsed) toggle();
          if (e.key === 'ArrowLeft') {
            if (!collapsed && node?.children?.length) toggle();
            else store.selectParent();
          }
          if (e.key === 'Escape') store.selectParent();
        }}
      >
        {t(`designer.editor.componentNames.${node?.type ?? ''}`, {
          defaultValue: node?.type ?? '',
        })}{' '}
        <small>{id}</small>
      </button>
    </div>
  );
}
export function LeftPanel({ store }: { store: EditorStore }) {
  const state = useEditor(store),
    { t, i18n } = useTranslation();
  const [tab, setTab] = useState('components'),
    [search, setSearch] = useState('');
  const [nodeSearch, setNodeSearch] = useState('');
  const [pageSearch, setPageSearch] = useState('');
  const [searchPage, setSearchPage] = useState(0);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const scroll = useRef<HTMLDivElement>(null);
  const page = state.document.pages.find((p) => p.id === state.pageId);
  const flat: { id: string; depth: number }[] = [];
  const walk = (id: string, depth: number) => {
    flat.push({ id, depth });
    if (!collapsed.has(id))
      for (const child of store.node(id)?.children ?? []) walk(child.id, depth + 1);
  };
  if (page) walk(page.layout.id, 0);
  const virtual = useVirtualizer({
    count: flat.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 34,
    overscan: 8,
  });
  const query = searchText(nodeSearch);
  const matches = useMemo(
    () =>
      findComponents(state.document, query, i18n.resolvedLanguage ?? i18n.language, (type) =>
        t(`designer.editor.componentNames.${type}`, { defaultValue: type }),
      ),
    [state.document, query, i18n.resolvedLanguage, i18n.language, t],
  );
  const lastResultPage = Math.max(0, Math.ceil(matches.length / 50) - 1);
  const resultPage = Math.min(searchPage, lastResultPage);
  const visibleMatches = matches.slice(resultPage * 50, (resultPage + 1) * 50);
  const pages = state.document.pages.filter((candidate) =>
    searchText(`${candidate.id} ${candidate.name}`).includes(searchText(pageSearch)),
  );
  const categories = [...new Set(editorRegistry.list().map((d) => d.designerMeta.category))];
  const insert = (type: string) => {
    let target = state.selection[0] ?? page?.layout.id;
    while (target && !store.canDrop(target, type)) target = store.location(target)?.parent?.id;
    if (target)
      store.execute(() => {
        store.insert(type, target);
      });
  };
  return (
    <aside className="ed-left" aria-label={t('designer.editor.components')}>
      <Tabs
        label={t('designer.editor.components')}
        value={tab}
        onValueChange={setTab}
        items={['components', 'layers', 'pages'].map((value) => ({
          value,
          label: t(`designer.editor.${value}`),
          content: <div />,
        }))}
      />
      {tab === 'components' && (
        <>
          <Input
            label={t('designer.editor.search')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
          />
          <div className="ed-palette">
            {categories.map((category) => (
              <section key={category}>
                <h3>
                  {t(`designer.editor.componentGroups.${category}`, { defaultValue: category })}
                </h3>
                {editorRegistry
                  .list()
                  .filter(
                    (d) =>
                      d.designerMeta.category === category &&
                      (
                        d.type +
                        ' ' +
                        t(`designer.editor.componentNames.${d.type}`, { defaultValue: d.type })
                      )
                        .toLocaleLowerCase()
                        .includes(search.toLocaleLowerCase()) &&
                      d.designerMeta.draggable,
                  )
                  .map((d) => (
                    <PaletteItem
                      key={d.type}
                      type={d.type}
                      insert={() => {
                        insert(d.type);
                      }}
                    />
                  ))}
              </section>
            ))}
          </div>
        </>
      )}
      {tab === 'layers' && (
        <>
          <Input
            label={t('designer.editor.findNode')}
            value={nodeSearch}
            onChange={(event) => {
              setNodeSearch(event.target.value);
              setSearchPage(0);
            }}
          />
          {query ? (
            <div
              className="ed-node-results"
              role="region"
              aria-label={t('designer.editor.nodeResults')}
            >
              {matches.length ? (
                visibleMatches.map((match) => (
                  <Button
                    key={match.id}
                    variant="ghost"
                    onClick={() => {
                      store.setView({ pageId: match.pageId });
                      store.select(match.id);
                      requestAnimationFrame(() => {
                        const element = [...document.querySelectorAll('[data-editor-node]')].find(
                          (item) => item.getAttribute('data-editor-node') === match.id,
                        );
                        element?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                      });
                    }}
                  >
                    <span>
                      {match.type} · {match.id}
                      <small>{match.pageName}</small>
                    </span>
                  </Button>
                ))
              ) : (
                <p role="status">{t('designer.editor.noMatchingNodes')}</p>
              )}
              {matches.length > 0 && (
                <div className="ed-search-navigation">
                  <p role="status">
                    {t('designer.editor.componentMatches', {
                      from: resultPage * 50 + 1,
                      to: Math.min((resultPage + 1) * 50, matches.length),
                      count: matches.length,
                    })}
                  </p>
                  {lastResultPage > 0 && (
                    <div>
                      <Button
                        variant="secondary"
                        disabled={resultPage === 0}
                        onClick={() => {
                          setSearchPage(resultPage - 1);
                        }}
                      >
                        {t('designer.editor.previousResults')}
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={resultPage === lastResultPage}
                        onClick={() => {
                          setSearchPage(resultPage + 1);
                        }}
                      >
                        {t('designer.editor.nextResults')}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div
              ref={scroll}
              className="ed-layer-scroll"
              role="tree"
              aria-label={t('designer.editor.layers')}
            >
              <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
                {virtual.getVirtualItems().map((item) => {
                  const row = flat[item.index];
                  return row ? (
                    <div
                      key={row.id}
                      style={{
                        position: 'absolute',
                        insetInline: 0,
                        top: item.start,
                        height: item.size,
                      }}
                    >
                      <Layer
                        {...row}
                        store={store}
                        collapsed={collapsed.has(row.id)}
                        toggle={() => {
                          setCollapsed((old) => {
                            const next = new Set(old);
                            if (next.has(row.id)) next.delete(row.id);
                            else next.add(row.id);
                            return next;
                          });
                        }}
                        navigate={(delta) => {
                          const index = Math.max(0, Math.min(flat.length - 1, item.index + delta));
                          const next = flat[index];
                          if (next) {
                            virtual.scrollToIndex(index);
                            store.select(next.id);
                            requestAnimationFrame(() => {
                              scroll.current
                                ?.querySelector(`[data-layer-id="${CSS.escape(next.id)}"]`)
                                ?.lastElementChild?.scrollIntoView({ block: 'nearest' });
                              const button = scroll.current?.querySelector(
                                `[data-layer-id="${CSS.escape(next.id)}"]`,
                              )?.lastElementChild;
                              if (button instanceof HTMLElement) button.focus();
                            });
                          }
                        }}
                      />
                    </div>
                  ) : null;
                })}
              </div>
            </div>
          )}
        </>
      )}
      {tab === 'pages' && (
        <div className="ed-page-controls">
          {page && (
            <Input
              label={t('designer.editor.pageName')}
              value={page.name}
              maxLength={120}
              disabled={store.readonlyPages.has(page.id)}
              onChange={(event) => {
                const name = event.target.value;
                store.execute(() => {
                  store.edit((document) => {
                    const current = document.pages.find((candidate) => candidate.id === page.id);
                    if (current) current.name = name;
                  });
                });
              }}
            />
          )}
          <Input
            label={t('designer.editor.findPage')}
            value={pageSearch}
            onChange={(event) => {
              setPageSearch(event.target.value);
            }}
          />
          <div className="ed-pages">
            {!pages.length && <p role="status">{t('designer.editor.noMatchingPages')}</p>}
            {pages.map((page) => (
              <Button
                key={page.id}
                variant={page.id === state.pageId ? 'secondary' : 'ghost'}
                onClick={() => {
                  store.setView({ pageId: page.id });
                }}
              >
                {page.name}
                {store.readonlyPages.has(page.id) && <Badge>{t('designer.editor.linked')}</Badge>}
              </Button>
            ))}
          </div>
          <Button
            onClick={() => {
              store.execute(() => {
                store.addPage(t('designer.editor.newPage'));
              });
            }}
          >
            {t('designer.editor.addPage')}
          </Button>
        </div>
      )}
    </aside>
  );
}
