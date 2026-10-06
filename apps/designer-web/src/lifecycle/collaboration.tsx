import { HocuspocusProvider } from '@hocuspocus/provider';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { applyDocumentChange, readDocument, LOCAL_EDIT, Y } from '@verbis/collaboration';
import { ScriptDocumentSchema } from '@verbis/script-schema';
import { CollaborationTicketSchema } from '@verbis/shared-types';
import { Button, Badge, Alert, Avatar } from '@verbis/ui';

import { request } from '../api/client.js';
import { type EditorStore } from '../editor/store.js';
import { useWorkspace } from '../workspace/context.js';

import { Comments } from './comments.js';
import './styles.css';

const Peer = z.object({
  userId: z.uuid(),
  pageId: z.string(),
  selection: z.array(z.string()),
  cursor: z.object({ x: z.number(), y: z.number() }).nullable(),
});
type Peer = z.infer<typeof Peer>;
const snapshot = (value: z.infer<typeof ScriptDocumentSchema>) =>
  JSON.stringify(value, (_key, entry: unknown) => {
    if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
      return Object.fromEntries(
        Object.entries(entry).sort(([left], [right]) => left.localeCompare(right)),
      );
    }
    return entry;
  });
export function CollaborationPanel({
  store,
  scriptId,
  number,
  ready,
  onSaved,
  onActive,
}: {
  store: EditorStore;
  scriptId: string;
  number: number;
  ready: boolean;
  onSaved: (version: number) => void;
  onActive: (active: boolean) => void;
}) {
  const { t } = useTranslation(),
    { session } = useWorkspace();
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(false),
    [status, setStatus] = useState('offline'),
    [peers, setPeers] = useState<Peer[]>([]);
  const provider = useRef<HocuspocusProvider | null>(null),
    callbacks = useRef({ onSaved, onActive });
  useEffect(() => {
    callbacks.current = { onSaved, onActive };
  }, [onSaved, onActive]);
  const state = store.getSnapshot();
  const members = useQuery({
    queryKey: [
      'workspace',
      session.user.tenantId,
      session.user.id,
      session.session.id,
      'collaboration-members',
      scriptId,
      number,
    ],
    queryFn: ({ signal }) =>
      request(
        `/v1/scripts/${scriptId}/versions/${number}/team-members`,
        z.array(z.object({ id: z.uuid(), name: z.string() })),
        { signal },
      ),
    enabled: active,
  });
  useEffect(() => {
    if (!active) return;
    store.setWriteSuspended(true);
    let disposed = false,
      applying = false,
      synced = false,
      last = store.getSnapshot().document;
    const doc = new Y.Doc(),
      undo = new Y.UndoManager(doc.getMap('script'), {
        trackedOrigins: new Set([LOCAL_EDIT]),
        captureTimeout: 500,
      });
    const socket = new HocuspocusProvider({
      url: `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/collaboration`,
      name: `${session.user.tenantId}:${scriptId}:${number}`,
      document: doc,
      token: async () => {
        const value = await request(
          `/v1/scripts/${scriptId}/versions/${number}/collaboration/ticket`,
          CollaborationTicketSchema,
          { method: 'POST', csrf: session.csrfToken },
        );
        return value.ticket;
      },
      onSynced: () => {
        if (disposed) return;
        synced = true;
        store.setWriteSuspended(false);
        applyRemote();
        setStatus('connected');
        socket.setAwarenessField('pageId', store.getSnapshot().pageId);
        socket.setAwarenessField('selection', [...store.getSnapshot().selection]);
        socket.setAwarenessField('cursor', null);
      },
      onAuthenticationFailed: () => {
        store.setWriteSuspended(true);
        setStatus('failed');
      },
      onDisconnect: () => {
        if (!disposed) {
          store.setWriteSuspended(true);
          setStatus((previous) =>
            ['conflict', 'failed', 'invalid'].includes(previous) ? previous : 'offline',
          );
        }
      },
      onAwarenessChange: () => {
        const other = socket.awareness
          ? [...socket.awareness.getStates().entries()]
              .filter(([id]) => id !== doc.clientID)
              .flatMap(([, v]) => {
                const value = Peer.safeParse(v);
                return value.success ? [value.data] : [];
              })
          : [];
        setPeers(other);
      },
      onStateless: ({ payload }) => {
        const result = z
          .discriminatedUnion('type', [
            z.object({
              type: z.literal('saved'),
              version: z.number().int(),
              stateVector: z.array(z.number().int().min(0).max(255)),
            }),
            z.object({ type: z.literal('conflict') }),
            z.object({ type: z.literal('invalid') }),
          ])
          .safeParse(
            (() => {
              try {
                return JSON.parse(payload) as unknown;
              } catch {
                return null;
              }
            })(),
          );
        if (!result.success) return;
        if (result.data.type === 'invalid') {
          setStatus('invalid');
          return;
        }
        if (result.data.type === 'conflict') {
          setStatus('conflict');
          socket.disconnect();
        } else {
          if (
            JSON.stringify(Array.from(Y.encodeStateVector(doc))) ===
            JSON.stringify(result.data.stateVector)
          ) {
            callbacks.current.onSaved(result.data.version);
            setStatus('connected');
          } else setStatus('pending');
        }
      },
    });
    provider.current = socket;
    callbacks.current.onActive(true);

    function applyRemote() {
      if (!synced || disposed) return;
      try {
        applying = true;
        store.applyRemote(readDocument(doc));
        last = store.getSnapshot().document;
      } catch {
        setStatus('conflict');
      } finally {
        applying = false;
      }
    }
    const detach = store.attachSharedHistory(
      () => undo.undo(),
      () => undo.redo(),
    );
    const observe = () => {
      if (!applying) applyRemote();
    };
    doc.getMap('script').observeDeep(observe);
    const unsubscribe = store.subscribe(() => {
      if (applying || !synced) return;
      const next = store.getSnapshot();
      socket.setAwarenessField('pageId', next.pageId);
      socket.setAwarenessField('selection', [...next.selection]);
      if (next.document !== last) {
        applying = true;
        try {
          applyDocumentChange(doc, last, next.document);
        } finally {
          applying = false;
        }
        applyRemote();
        setStatus('pending');
      }
    });
    let animation: number | undefined;
    const move = (event: PointerEvent) => {
      const canvas = document.querySelector('.ed-canvas');
      if (!canvas || animation !== undefined) return;
      animation = requestAnimationFrame(() => {
        animation = undefined;
        const rect = canvas.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width,
          y = (event.clientY - rect.top) / rect.height;
        socket.setAwarenessField('cursor', x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null);
      });
    };
    document.addEventListener('pointermove', move, { passive: true });
    return () => {
      disposed = true;
      if (animation !== undefined) cancelAnimationFrame(animation);
      document.removeEventListener('pointermove', move);
      unsubscribe();
      detach();
      store.setWriteSuspended(false);
      doc.getMap('script').unobserveDeep(observe);
      socket.destroy();
      undo.destroy();
      doc.destroy();
      provider.current = null;
      callbacks.current.onActive(false);
      setPeers([]);
    };
  }, [active, session.user.tenantId, session.user.id, session.csrfToken, scriptId, number, store]);
  useEffect(() => {
    const canvas = document.querySelector('.ed-canvas');
    if (!(canvas instanceof HTMLElement)) return;
    const overlay = document.createElement('div');
    overlay.className = 'lc-peer-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    for (const peer of peers.filter((p) => p.pageId === state.pageId)) {
      if (peer.cursor) {
        const cursor = document.createElement('span');
        cursor.className = 'lc-peer-cursor';
        cursor.style.insetInlineStart = `${peer.cursor.x * 100}%`;
        cursor.style.top = `${peer.cursor.y * 100}%`;
        cursor.textContent = `↖ ${members.data?.find((user) => user.id === peer.userId)?.name ?? peer.userId.slice(0, 8)}`;
        overlay.append(cursor);
      }
      for (const id of peer.selection) {
        const element = [...canvas.querySelectorAll('[data-editor-node]')].find(
          (el) => el.getAttribute('data-editor-node') === id,
        )?.firstElementChild;
        if (!element) continue;
        const box = element.getBoundingClientRect(),
          host = canvas.getBoundingClientRect(),
          selection = document.createElement('span');
        selection.className = 'lc-peer-selection';
        Object.assign(selection.style, {
          insetInlineStart: `${box.left - host.left}px`,
          top: `${box.top - host.top}px`,
          width: `${box.width}px`,
          height: `${box.height}px`,
        });
        selection.textContent =
          members.data?.find((user) => user.id === peer.userId)?.name ?? peer.userId.slice(0, 8);
        overlay.append(selection);
      }
    }
    canvas.append(overlay);
    return () => {
      overlay.remove();
    };
  }, [peers, state.pageId, state.document, members.data]);
  const leave = async () => {
    setStatus('saving');
    store.setWriteSuspended(true);
    try {
      await request(
        `/v1/scripts/${scriptId}/versions/${number}/collaboration/flush`,
        z.object({ closed: z.boolean() }),
        { method: 'POST', csrf: session.csrfToken },
      );
      const persisted = await request(
        `/v1/scripts/${scriptId}/versions/${number}`,
        z.object({ version: z.number().int(), document: ScriptDocumentSchema }),
      );
      // A flush closes all peers. Never mark local edits clean unless the final
      // persisted document matches; unsent or divergent edits must remain recoverable.
      if (snapshot(persisted.document) !== snapshot(store.getSnapshot().document)) {
        setStatus('conflict');
        return;
      }
      flushSync(() => {
        callbacks.current.onSaved(persisted.version);
      });
      provider.current?.disconnect();
      window.location.reload();
    } catch {
      setStatus('conflict');
    }
  };
  return (
    <>
      <div className="lc-presence">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setOpen((v) => !v);
          }}
        >
          {t('designer.lifecycle.team')}
        </Button>
        {peers.map((peer, i) => (
          <Avatar
            key={`${peer.userId}-${i}`}
            name={
              members.data?.find((user) => user.id === peer.userId)?.name ?? peer.userId.slice(0, 8)
            }
            size="sm"
          />
        ))}
        <Badge
          tone={
            status === 'connected'
              ? 'success'
              : status === 'conflict' || status === 'failed'
                ? 'danger'
                : 'info'
          }
        >
          {t(`designer.lifecycle.connection.${status}`)}
        </Badge>
        {!active ? (
          <Button
            size="sm"
            disabled={!ready}
            onClick={() => {
              setStatus('connecting');
              setActive(true);
            }}
          >
            {t('designer.lifecycle.join')}
          </Button>
        ) : (
          <Button size="sm" loading={status === 'saving'} onClick={() => void leave()}>
            {t('designer.lifecycle.flush')}
          </Button>
        )}
      </div>
      {['conflict', 'failed'].includes(status) && (
        <Alert tone="danger" title={t('designer.lifecycle.failed')} />
      )}
      {open && (
        <>
          <p>{t('designer.lifecycle.collaborationHelp')}</p>
          <Comments scriptId={scriptId} number={number} nodeId={state.selection[0] ?? 'script'} />
        </>
      )}
    </>
  );
}
