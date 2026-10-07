import {
  DndContext,
  pointerWithin,
  rectIntersection,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useQuery } from '@tanstack/react-query';
import {
  Undo2,
  Redo2,
  Copy,
  ClipboardPaste,
  CopyPlus,
  Trash2,
  Group,
  Ungroup,
  Keyboard,
  Maximize2,
  Minimize2,
  PanelRight,
} from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBlocker, useParams } from 'react-router-dom';
import { z } from 'zod';

import { useAbility } from '@verbis/authz/react';
import { Button, Select, Badge, Dialog, Alert } from '@verbis/ui';

import { request, ApiError } from '../api/client.js';
import { CollaborationPanel } from '../lifecycle/collaboration.js';
import { useContributeCommands } from '../workspace/commands.js';
import { useWorkspace } from '../workspace/context.js';
import { Loading, Failure } from '../workspace/states.js';

import { Canvas } from './canvas.js';
import { EDIT_ACTIONS, editorCommands, isApplePlatform, type EditAction } from './commands.js';
import { DataSources } from './data-sources.js';
import { dragAnnouncements, dragInstructions, dragLabel } from './drag-a11y.js';
import { DropGuides, measureNodes } from './drop-guides.js';
import { resolveDrop } from './drop-position.js';
import { HealthPanel } from './health-panel.js';
import { HeatmapContext, useHeatmap } from './heatmap.js';
import { Inspector } from './inspector.js';
import { LeftPanel } from './layers.js';
import { LinkedScreens } from './linked-screens.js';
import { LivePane } from './live-pane.js';
import { ReuseScreen } from './reuse-screen.js';
import { EditorDocumentSchema, EditorStore, useEditor } from './store.js';
import { SuggestMode } from './suggest-mode.js';

import type { IssueTarget } from './health.js';
import '../flow/styles.css';
import './editor.css';

const PreviewStudio = lazy(() =>
  import('../preview/studio.js').then((m) => ({ default: m.PreviewStudio })),
);
const FlowDesigner = lazy(() =>
  import('../flow/designer.js').then((m) => ({ default: m.FlowDesigner })),
);
const RuleManager = lazy(() =>
  import('../rules/manager.js').then((m) => ({ default: m.RuleManager })),
);
const VariableManager = lazy(() =>
  import('../flow/variable-manager.js').then((m) => ({ default: m.VariableManager })),
);

const LIVE_PREFERENCE = 'verbis.editor.liveView';
function readLivePreference(): boolean {
  try {
    return localStorage.getItem(LIVE_PREFERENCE) === 'on';
  } catch {
    return false;
  }
}
function writeLivePreference(on: boolean) {
  try {
    localStorage.setItem(LIVE_PREFERENCE, on ? 'on' : 'off');
  } catch {
    /* A per-viewer convenience only. */
  }
}

const actionIcons = {
  undo: Undo2,
  redo: Redo2,
  copy: Copy,
  paste: ClipboardPaste,
  duplicate: CopyPlus,
  delete: Trash2,
  group: Group,
  ungroup: Ungroup,
};

type Version = z.infer<typeof EditorDocumentSchema>;
export default function EditorPage() {
  const { id, number } = useParams();
  const { session, environment } = useWorkspace();
  const version = useQuery({
    queryKey: [
      'workspace',
      session.user.tenantId,
      session.user.id,
      session.session.id,
      environment,
      'editor',
      id,
      number,
    ],
    queryFn: ({ signal }) =>
      request(`/v1/scripts/${id ?? ''}/versions/${number ?? ''}`, EditorDocumentSchema, { signal }),
    refetchOnWindowFocus: false,
    refetchOnMount: 'always',
  });
  if (version.isError)
    return (
      <Failure
        error={version.error}
        retry={() => {
          void version.refetch();
        }}
      />
    );
  // Cached documents may precede an autosave performed during the last visit.
  // Mount the editing store only after the fresh document and ETag arrive together.
  if (!version.data || version.isFetching) return <Loading />;
  return <Editor key={version.data.id} version={version.data} scriptId={id ?? ''} />;
}
export function Editor({ version, scriptId }: { version: Version; scriptId: string }) {
  const { t, i18n } = useTranslation(),
    { session } = useWorkspace();
  const [store] = useState(
    () =>
      new EditorStore(
        version.document,
        new Set(
          version.state === 'draft'
            ? version.screens.filter((s) => s.mode === 'linked').flatMap((s) => s.pageIds)
            : version.document.pages.map((p) => p.id),
        ),
      ),
  );
  const state = useEditor(store),
    [mode, setMode] = useState('screen'),
    [collaborating, setCollaborating] = useState(false),
    [suggesting, setSuggesting] = useState(false),
    [help, setHelp] = useState(false),
    [expanded, setExpanded] = useState(false),
    [live, setLive] = useState(readLivePreference),
    [healthOpen, setHealthOpen] = useState(false),
    [ghost, setGhost] = useState<string | null>(null),
    [placed, setPlaced] = useState(''),
    [save, setSave] = useState('saved'),
    [saved, setSaved] = useState(state.document),
    [documentRevision, setDocumentRevision] = useState(version.version);
  const etag = useRef(version.version),
    inFlight = useRef(false),
    conflict = useRef(false);

  const heatmap = useHeatmap(scriptId, version.id, state.pageId);
  const dirty = saved !== state.document;
  const blocker = useBlocker(dirty);
  const ability = useAbility();
  const issues = store.issues();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );
  useEffect(() => {
    if (
      collaborating ||
      suggesting ||
      !dirty ||
      version.state !== 'draft' ||
      conflict.current ||
      save === 'saveFailed'
    )
      return;
    const timer = setTimeout(() => {
      if (inFlight.current) return;
      if (store.issues().some((i) => i.severity === 'error')) {
        setSave('invalid');
        return;
      }
      const document = store.getSnapshot().document;
      inFlight.current = true;
      setSave('saving');
      void request(
        `/v1/scripts/${scriptId}/versions/${version.number}/document`,
        z.object({ version: z.number().int() }),
        {
          method: 'PUT',
          csrf: session.csrfToken,
          ifMatch: `"${etag.current}"`,
          body: {
            document,
            screens: version.screens.map(({ sharedScreenId, versionNumber, mode }) => ({
              sharedScreenId,
              versionNumber,
              mode,
            })),
          },
        },
      )
        .then((result) => {
          etag.current = result.version;
          setDocumentRevision(result.version);
          setSaved(document);
          setSave('saved');
        })
        .catch((error: unknown) => {
          if (error instanceof ApiError && (error.status === 409 || error.status === 412)) {
            conflict.current = true;
            setSave('conflict');
          } else setSave('saveFailed');
        })
        .finally(() => {
          inFlight.current = false;
        });
    }, 800);
    return () => {
      clearTimeout(timer);
    };
  }, [
    state.document,
    dirty,
    save,
    session.csrfToken,
    scriptId,
    store,
    version,
    collaborating,
    suggesting,
  ]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        // Legacy browsers also require the cancellation flag.
        Reflect.set(event, 'returnValue', '');
      }
    };
    window.addEventListener('beforeunload', unload);
    return () => {
      window.removeEventListener('beforeunload', unload);
    };
  }, [dirty, t]);
  const target = useCallback(() => {
    const selected = state.selection[0];
    return selected && store.canDrop(selected, 'box')
      ? selected
      : ((selected ? store.location(selected)?.parent?.id : undefined) ??
          state.document.pages.find((p) => p.id === state.pageId)?.layout.id);
  }, [state.selection, state.document.pages, state.pageId, store]);
  const selectionRoots = store.roots();
  const editableChildren =
    selectionRoots.length > 0 &&
    selectionRoots.every((id) => {
      const location = store.location(id);
      return !!location?.parent && !store.readonlyPages.has(location.pageId);
    });
  const commonParent =
    editableChildren &&
    selectionRoots.every(
      (id) =>
        store.location(id)?.parent?.id === store.location(selectionRoots[0] ?? '')?.parent?.id,
    );
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (document.querySelector('[role=dialog][data-state=open]')) return;
      if (event.key === 'Escape' && expanded) {
        event.preventDefault();
        setExpanded(false);
        return;
      }
      if ((event.target as Element).closest('input,textarea,[contenteditable="true"]')) return;
      if (mode !== 'screen' && ['Delete', 'Backspace', 'Escape'].includes(event.key)) return;
      const mod = event.ctrlKey || event.metaKey;
      const letter = event.key.toLowerCase();
      if (mode !== 'screen' && mod && !['z', 'y'].includes(letter)) return;
      let work: (() => void) | undefined;
      if (event.key === 'Escape')
        work = () => {
          store.selectParent();
        };
      if (event.key === 'Delete' || event.key === 'Backspace')
        work = () => {
          store.remove();
        };
      if (mod && letter === 'z')
        work = () => {
          if (event.shiftKey) store.redo();
          else store.undo();
        };
      if (mod && letter === 'y')
        work = () => {
          store.redo();
        };
      if (mode === 'screen' && mod && letter === 'c')
        work = () => {
          store.copy();
        };
      if (mode === 'screen' && mod && letter === 'v')
        work = () => {
          const parent = target();
          if (parent) store.paste(parent);
        };
      if (mode === 'screen' && mod && letter === 'd')
        work = () => {
          store.duplicate();
        };
      if (mode === 'screen' && mod && letter === 'g')
        work = () => {
          if (event.shiftKey) store.ungroup();
          else store.group();
        };
      if (mod && ['+', '=', '-'].includes(event.key))
        work = () => {
          store.setView({
            zoom: Math.max(
              0.1,
              Math.min(2, store.getSnapshot().zoom + (event.key === '-' ? -0.25 : 0.25)),
            ),
          });
        };
      if (event.key === '?')
        work = () => {
          setHelp(true);
        };
      if (work) {
        event.preventDefault();
        store.execute(work);
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
    };
  }, [store, state.selection, state.pageId, target, mode, expanded]);
  const drop = ({ active, over, activatorEvent, delta }: DragEndEvent) => {
    setGhost(null);
    if (!over) return;
    const data = active.data.current as { type?: string; nodeId?: string } | undefined;
    let parent: string | undefined, index: number | undefined;
    const overData = over.data.current as { nodeId?: string } | undefined;
    if (overData?.nodeId) {
      const loc = store.location(overData.nodeId);
      parent = loc?.parent?.id;
      index = loc?.index;
    } else {
      const pointer =
        activatorEvent instanceof MouseEvent
          ? { x: activatorEvent.clientX + delta.x, y: activatorEvent.clientY + delta.y }
          : null;
      const kind = data?.type ?? (data?.nodeId ? store.node(data.nodeId)?.type : undefined);
      const resolved =
        pointer && kind ? resolveDrop(store, kind, data?.nodeId, pointer, measureNodes()) : null;
      if (resolved) {
        parent = resolved.parent;
        index = resolved.index;
      } else {
        // Keyboard drops insert after the selected leaf (or append to the selected container).
        const picked = state.selection[0];
        const pickedLocation = picked ? store.location(picked) : undefined;
        parent = target();
        if (data?.type && pickedLocation?.parent?.id === parent && picked !== parent && !pointer)
          index = (pickedLocation?.index ?? 0) + 1;
      }
    }
    const type = data?.type ?? (data?.nodeId ? store.node(data.nodeId)?.type : undefined);
    while (parent && type && !store.canDrop(parent, type, data?.nodeId))
      parent = store.location(parent)?.parent?.id;
    if (!parent || !type) return;
    const destination = parent;
    store.execute(() => {
      if (data?.type) store.insert(type, destination, index);
      else if (data?.nodeId) {
        const ids = state.selection.includes(data.nodeId) ? store.roots() : [data.nodeId];
        store.batch(() => {
          for (const [offset, id] of ids.entries()) {
            const location = store.location(id);
            const adjusted =
              index === undefined
                ? undefined
                : Math.max(
                    0,
                    index +
                      offset -
                      (location?.parent?.id === destination && (location.index ?? 0) < index
                        ? 1
                        : 0),
                  );
            store.move(id, destination, adjusted);
          }
        });
      }
    });
    // D-04: dnd-kit only knows the droppable id; announce the real sibling position.
    const placedId = data?.type ? store.getSnapshot().selection[0] : data?.nodeId;
    const placedAt = placedId ? store.location(placedId) : undefined;
    if (placedAt?.parent)
      setPlaced(
        t('designer.editor.dnd.placed', {
          name: t(`designer.editor.componentNames.${placedAt.node.type}`, {
            defaultValue: placedAt.node.type,
          }),
          position: (placedAt.index ?? 0) + 1,
          count: placedAt.parent.children?.length ?? 1,
          target: t(`designer.editor.componentNames.${placedAt.parent.type}`, {
            defaultValue: placedAt.parent.type,
          }),
        }),
      );
  };
  const actionDisabled = (action: EditAction) =>
    version.state !== 'draft' ||
    state.writeSuspended ||
    (mode !== 'screen' && action !== 'undo' && action !== 'redo') ||
    (action === 'undo' && !state.history) ||
    (action === 'redo' && !state.future) ||
    (action === 'copy' && !selectionRoots.length) ||
    (action === 'paste' && !store.canPaste(target())) ||
    (action === 'delete' && !editableChildren) ||
    ((action === 'duplicate' || action === 'group') && !commonParent) ||
    (action === 'ungroup' &&
      (!editableChildren ||
        selectionRoots.length !== 1 ||
        store.node(selectionRoots[0] ?? '')?.type !== 'box'));
  const runAction = (action: EditAction) => {
    store.execute(() => {
      if (action === 'delete') store.remove();
      else if (action === 'paste') {
        const parent = target();
        if (parent) store.paste(parent);
      } else store[action]();
    });
  };
  const goTo = (goal: IssueTarget) => {
    setMode(goal.mode);
    if (goal.mode !== 'screen') return;
    store.setView({ pageId: goal.pageId });
    if (goal.nodeId) store.select(goal.nodeId);
    requestAnimationFrame(() => {
      document.getElementById('editor-canvas')?.focus({ preventScroll: true });
      document.querySelector('.ed-selection')?.scrollIntoView({ block: 'nearest' });
    });
  };
  const insertComponent = (type: string) => {
    let parent = target();
    while (parent && !store.canDrop(parent, type)) parent = store.location(parent)?.parent?.id;
    const destination = parent;
    if (destination)
      store.execute(() => {
        store.insert(type, destination);
      });
  };
  const toggleLive = () => {
    setLive((value) => {
      writeLivePreference(!value);
      return !value;
    });
  };
  useContributeCommands('editor', (query) =>
    editorCommands(
      {
        t: (key, options) => t(key, options ?? {}),
        store,
        locale: i18n.resolvedLanguage ?? i18n.language,
        apple: isApplePlatform(),
        mode,
        setMode,
        editable:
          version.state === 'draft' &&
          !state.writeSuspended &&
          !store.readonlyPages.has(state.pageId) &&
          ability.can('update', 'Script'),
        actionDisabled,
        runAction,
        insert: insertComponent,
        addBlock: (block, name) => {
          store.execute(() => {
            store.addBlock(block, name);
          });
        },
        goTo,
        live,
        toggleLive,
        expanded,
        toggleExpanded: () => {
          setExpanded((value) => !value);
        },
        openHealth: () => {
          setHealthOpen(true);
        },
        openShortcuts: () => {
          setHelp(true);
        },
      },
      query,
    ),
  );
  const selected = state.selection[0];
  const ancestors: string[] = [];
  let loc = selected ? store.location(selected) : undefined;
  while (loc) {
    ancestors.unshift(loc.node.id);
    loc = loc.parent ? store.location(loc.parent.id) : undefined;
  }
  return (
    <div className="ed-workspace" data-expanded={expanded}>
      <a className="vb-skip-link" href="#editor-palette">
        {t('designer.editor.jumpPalette')}
      </a>
      <a className="vb-skip-link" href="#editor-canvas">
        {t('designer.editor.jumpCanvas')}
      </a>
      <header className="ed-toolbar">
        <div className="ed-identity">
          <Badge>{t('designer.editor.title')}</Badge>
          <h1 className="ed-document-title">{state.document.meta.name}</h1>
          <Select
            label={t('designer.flow.tool')}
            value={mode}
            options={['screen', 'flow', 'rules', 'variables', 'preview'].map((value) => ({
              value,
              label: t(`designer.flow.tools.${value}`),
            }))}
            onValueChange={setMode}
          />
          <Badge tone={save === 'saved' ? 'success' : 'warning'}>
            {t(`designer.editor.${save}`)}
          </Badge>
          <HealthPanel
            store={store}
            document={state.document}
            fieldProblems={state.fieldProblems}
            open={healthOpen}
            onOpenChange={setHealthOpen}
            onNavigate={goTo}
          />
        </div>
        <div className="ed-commands">
          {version.state === 'draft' &&
            ability.can('update', 'Script') &&
            ability.can('read', 'Integration') && <DataSources store={store} />}
          {EDIT_ACTIONS.map((action) => (
            <Button
              key={action}
              className="ed-command"
              aria-label={t(`designer.editor.${action}`)}
              title={t(`designer.editor.${action}`)}
              size="sm"
              variant="ghost"
              disabled={actionDisabled(action)}
              onClick={() => {
                runAction(action);
              }}
            >
              {(() => {
                const Icon = actionIcons[action];
                return <Icon size={17} aria-hidden />;
              })()}
            </Button>
          ))}
          {!collaborating && version.state === 'draft' && ability.can('read', 'Screen') && (
            <ReuseScreen
              used={version.screens.map((s) => s.sharedScreenId)}
              attach={async (sharedScreenId, versionNumber) => {
                if (
                  inFlight.current ||
                  conflict.current ||
                  store.issues().some((i) => i.severity === 'error')
                )
                  throw new Error('VERBIS_DRAFT_NOT_READY');
                const document = store.getSnapshot().document;
                inFlight.current = true;
                try {
                  const result = await request(
                    `/v1/scripts/${scriptId}/versions/${version.number}/document`,
                    z.object({ version: z.number().int() }),
                    {
                      method: 'PUT',
                      csrf: session.csrfToken,
                      ifMatch: `"${etag.current}"`,
                      body: {
                        document,
                        screens: [
                          ...version.screens.map(({ sharedScreenId, versionNumber, mode }) => ({
                            sharedScreenId,
                            versionNumber,
                            mode,
                          })),
                          { sharedScreenId, versionNumber, mode: 'linked' },
                        ],
                      },
                    },
                  );
                  etag.current = result.version;
                  setDocumentRevision(result.version);
                  setSaved(document);
                  setTimeout(() => {
                    window.location.reload();
                  }, 0);
                } finally {
                  inFlight.current = false;
                }
              }}
            />
          )}
          {!collaborating && version.state === 'draft' && ability.can('read', 'Script') && (
            <SuggestMode
              scriptId={scriptId}
              number={version.number}
              store={store}
              suggesting={suggesting}
              canEnter={!dirty && save === 'saved'}
              onSuggestingChange={setSuggesting}
              onRestored={() => {
                setSaved(store.getSnapshot().document);
                setSave('saved');
              }}
            />
          )}
          {mode === 'screen' && (
            <Button
              variant="secondary"
              size="sm"
              className="ed-live-toggle"
              aria-pressed={live}
              startIcon={<PanelRight size={16} aria-hidden />}
              onClick={toggleLive}
            >
              {t('designer.live.toggle')}
            </Button>
          )}
          <Button
            className="ed-command"
            aria-label={t('designer.editor.shortcuts')}
            title={t('designer.editor.shortcuts')}
            variant="ghost"
            onClick={() => {
              setHelp(true);
            }}
          >
            <Keyboard size={18} aria-hidden />
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="ed-expand"
            aria-pressed={expanded}
            startIcon={
              expanded ? <Minimize2 size={16} aria-hidden /> : <Maximize2 size={16} aria-hidden />
            }
            onClick={() => {
              setExpanded((value) => !value);
            }}
          >
            {t(expanded ? 'designer.editor.exitFullscreen' : 'designer.editor.fullscreen')}
          </Button>
        </div>
      </header>
      <nav className="ed-mode-shortcuts" aria-label={t('designer.flow.tool')}>
        {['screen', 'flow', 'rules', 'variables', 'preview'].map((value) => (
          <Button
            key={value}
            size="sm"
            variant="ghost"
            aria-pressed={mode === value}
            onClick={() => {
              setMode(value);
            }}
          >
            {t(`designer.flow.tools.${value}`)}
          </Button>
        ))}
      </nav>
      {version.state === 'draft' && (
        <CollaborationPanel
          store={store}
          scriptId={scriptId}
          number={version.number}
          ready={!dirty && save === 'saved'}
          onActive={setCollaborating}
          onSaved={(version) => {
            etag.current = version;
            setDocumentRevision(version);
            setSaved(store.getSnapshot().document);
            setSave('saved');
          }}
        />
      )}
      {state.message && <Alert title={t(state.message)} tone="danger" />}
      {save === 'conflict' && <Alert title={t('designer.editor.conflict')} tone="danger" />}
      <nav className="ed-breadcrumb" aria-label={t('designer.editor.breadcrumb')}>
        {ancestors.map((id) => (
          <Button
            key={id}
            variant="ghost"
            size="sm"
            onClick={() => {
              store.select(id);
            }}
          >
            {store.node(id)?.type} /
          </Button>
        ))}
      </nav>
      {mode === 'screen' && store.readonlyPages.has(state.pageId) && (
        <Alert title={t('designer.editor.linkedReadonly')} tone="warning" />
      )}
      {mode === 'screen' && (
        <DndContext
          sensors={sensors}
          accessibility={{
            announcements: dragAnnouncements(store, t),
            screenReaderInstructions: dragInstructions(t),
          }}
          collisionDetection={(args) => {
            const hits = pointerWithin(args);
            return hits.length ? hits : rectIntersection(args);
          }}
          onDragStart={({ active }) => {
            setGhost(String(active.id));
          }}
          onDragEnd={drop}
          onDragCancel={() => {
            setGhost(null);
          }}
        >
          <DropGuides store={store} />
          <span className="vb-sr-only" role="status">
            {placed}
          </span>
          <fieldset
            className="ed-grid"
            data-live={live}
            disabled={state.writeSuspended || store.readonlyPages.has(state.pageId)}
          >
            <legend className="vb-sr-only">{t('designer.editor.title')}</legend>
            <LeftPanel store={store} />
            <HeatmapContext.Provider value={heatmap.rows}>
              <Canvas store={store} heatControl={heatmap.control} />
            </HeatmapContext.Provider>
            {live && <LivePane store={store} />}
            <Inspector store={store} />
          </fieldset>
          <DragOverlay>
            {ghost && <div className="ed-drag-ghost">{dragLabel(ghost, store, t)}</div>}
          </DragOverlay>
        </DndContext>
      )}
      <Suspense fallback={<Loading />}>
        {mode === 'preview' && (
          <PreviewStudio
            store={store}
            scriptId={scriptId}
            number={version.number}
            documentVersion={documentRevision}
            versionState={version.state}
            dirty={dirty}
          />
        )}
        {mode === 'flow' && (
          <FlowDesigner
            store={store}
            readOnly={version.state !== 'draft' || state.writeSuspended}
            openPage={(pageId) => {
              store.setView({ pageId });
              setMode('screen');
            }}
          />
        )}
        {mode === 'rules' && (
          <RuleManager store={store} readOnly={version.state !== 'draft' || state.writeSuspended} />
        )}{' '}
        {mode === 'variables' && (
          <VariableManager
            store={store}
            readOnly={version.state !== 'draft' || state.writeSuspended}
          />
        )}
      </Suspense>
      {save === 'saveFailed' && (
        <Button
          onClick={() => {
            setSave('pending');
          }}
        >
          {t('designer.editor.retry')}
        </Button>
      )}
      <LinkedScreens
        ids={version.screens
          .filter((s) => s.mode === 'linked' && s.pageIds.includes(state.pageId))
          .map((s) => s.sharedScreenId)}
      />
      <footer className="ed-status">
        <details>
          <summary>{t('designer.editor.issues')}</summary>
          {issues.map((issue, index) => (
            <p key={index}>
              {issue.path}: {t(issue.messageKey, issue.params ?? {})}
            </p>
          ))}
        </details>
        <span role="status">
          {t('designer.editor.validation', {
            count: issues.filter((i) => i.severity === 'error').length + state.fieldProblems,
          })}
        </span>
        <span>
          {state.selection.length} / {store.getSnapshot().document.pages.length}
        </span>
        <Select
          label={t('designer.editor.breakpoint')}
          value={state.breakpoint}
          options={['base', 'sm', 'md', 'lg', 'xl'].map((value) => ({
            value,
            label: t(`designer.editor.viewportNames.${value}`),
          }))}
          onValueChange={(value) => {
            if (['base', 'sm', 'md', 'lg', 'xl'].includes(value))
              store.setView({ breakpoint: value as typeof state.breakpoint });
          }}
        />
        <Select
          label={t('designer.editor.zoom')}
          value={String(state.zoom)}
          options={[...new Set([0.5, 0.75, 1, 1.25, 1.5, 2, state.zoom])]
            .sort((a, b) => a - b)
            .map((value) => ({
              value: String(value),
              label: `${Math.round(value * 100)}%`,
            }))}
          onValueChange={(value) => {
            store.setView({ zoom: Number(value) });
          }}
        />
      </footer>
      <Dialog
        open={blocker.state === 'blocked'}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
        title={t('designer.editor.unsaved')}
        description={t('designer.editor.unsaved')}
      >
        <Button
          onClick={() => {
            blocker.proceed?.();
          }}
        >
          {t('designer.editor.leave')}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            blocker.reset?.();
          }}
        >
          {t('designer.editor.stay')}
        </Button>
      </Dialog>
      <Dialog
        open={help}
        onOpenChange={setHelp}
        title={t('designer.editor.shortcuts')}
        description={t('designer.editor.shortcutDetail')}
      >
        <p>{t('designer.editor.shortcutsList')}</p>
      </Dialog>
    </div>
  );
}
