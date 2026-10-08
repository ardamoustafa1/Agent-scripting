import { HocuspocusProvider } from '@hocuspocus/provider';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { useAbility } from '@verbis/authz/react';
import { applyDocumentChange, readDocument, LOCAL_EDIT, Y } from '@verbis/collaboration';
import { ScriptDocumentSchema } from '@verbis/script-schema';
import { CollaborationTicketSchema } from '@verbis/shared-types';
import { Button, Badge, Alert, Avatar, Select } from '@verbis/ui';

import { request } from '../api/client.js';
import { type EditorStore } from '../editor/store.js';
import { useWorkspace } from '../workspace/context.js';

import { Comments } from './comments.js';
import { followView, peerTone } from './peers.js';
import { Suggestions } from './suggestions.js';
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
    [recoveryId, setRecoveryId] = useState<string | null>(null),
    [recovering, setRecovering] = useState(false),
    [peers, setPeers] = useState<Peer[]>([]),
    [following, setFollowing] = useState<string | null>(null),
    [followNotice, setFollowNotice] = useState('');
  const followingRef = useRef<string | null>(null);
  useEffect(() => {
    followingRef.current = following;
  }, [following]);
  const leftNotice = useRef((userId: string) => userId);
  const provider = useRef<HocuspocusProvider | null>(null),
    callbacks = useRef({ onSaved, onActive });
  useEffect(() => {
    callbacks.current = { onSaved, onActive };
  }, [onSaved, onActive]);
  const state = store.getSnapshot();
  const navigate = useNavigate(),
    ability = useAbility();
  const recoveries = useQuery({
    queryKey: [
      'workspace',
      session.user.tenantId,
      session.user.id,
      session.session.id,
      'collaboration-conflicts',
      scriptId,
      number,
    ],
    queryFn: ({ signal }) =>
      request(
        `/v1/scripts/${scriptId}/versions/${number}/collaboration/conflicts`,
        z.array(
          z.object({
            id: z.uuid(),
            baseVersion: z.int(),
            currentVersion: z.int(),
            createdAt: z.string(),
          }),
        ),
        { signal },
      ),
    enabled: open,
  });
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
    const failInitial = () => {
      if (disposed || synced) return;
      setStatus('failed');
      setActive(false);
    };
    const connectionDeadline = window.setTimeout(failInitial, 10_000);
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
        window.clearTimeout(connectionDeadline);
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
        if (!synced) failInitial();
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
        // Following stops when the colleague leaves the room.
        const followed = followingRef.current;
        if (followed && !other.some((peer) => peer.userId === followed)) {
          followingRef.current = null;
          setFollowing(null);
          setFollowNotice(leftNotice.current(followed));
        }
      },
      onStateless: ({ payload }) => {
        const result = z
          .discriminatedUnion('type', [
            z.object({
              type: z.literal('saved'),
              version: z.number().int(),
              stateVector: z.array(z.number().int().min(0).max(255)),
            }),
            z.object({ type: z.literal('conflict'), recoveryId: z.uuid().optional() }),
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
          setRecoveryId(result.data.recoveryId ?? null);
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
      window.clearTimeout(connectionDeadline);
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
        cursor.dataset['tone'] = peerTone(peer.userId);
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
        selection.dataset['tone'] = peerTone(peer.userId);
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
  const nameOf = (userId: string) =>
    members.data?.find((user) => user.id === userId)?.name ?? userId.slice(0, 8);
  useEffect(() => {
    leftNotice.current = (userId) =>
      t('designer.collaboration.followEnded', {
        name: members.data?.find((user) => user.id === userId)?.name ?? userId.slice(0, 8),
      });
  }, [members.data, t]);
  // C1 follow mode: go where the colleague is; scroll to what they selected without selecting it.
  const target = followView(peers, following);
  const targetPage = target?.pageId,
    targetNode = target?.nodeId;
  useEffect(() => {
    if (!following || !targetPage) return;
    if (store.getSnapshot().pageId !== targetPage) store.setView({ pageId: targetPage });
    const node = targetNode;
    if (!node) return;
    const frame = requestAnimationFrame(() => {
      [...document.querySelectorAll('.ed-canvas [data-editor-node]')]
        .find((element) => element.getAttribute('data-editor-node') === node)
        ?.firstElementChild?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [following, targetPage, targetNode, store]);
  // Any local interaction with the canvas hands control back to the designer.
  useEffect(() => {
    if (!following) return;
    const stop = (event: Event) => {
      if (event instanceof KeyboardEvent && ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key))
        return;
      if (event.target instanceof Element && event.target.closest('.lc-presence')) return;
      setFollowing(null);
      setFollowNotice(t('designer.collaboration.followStopped'));
    };
    document.addEventListener('pointerdown', stop, true);
    document.addEventListener('keydown', stop, true);
    return () => {
      document.removeEventListener('pointerdown', stop, true);
      document.removeEventListener('keydown', stop, true);
    };
  }, [following, t]);
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
  const createRecovery = async () => {
    setRecovering(true);
    try {
      const created = await request(
        `/v1/scripts/${scriptId}/versions`,
        z.object({ number: z.int().positive(), version: z.int().positive() }),
        {
          method: 'POST',
          csrf: session.csrfToken,
          idempotencyKey: crypto.randomUUID(),
          body: { document: store.getSnapshot().document, screens: [] },
        },
      );
      flushSync(() => {
        callbacks.current.onSaved(created.version);
      });
      void navigate(`/scripts/${scriptId}/versions/${created.number}/edit`);
    } catch {
      setStatus('recovered');
    } finally {
      setRecovering(false);
    }
  };
  const recover = async () => {
    if (!recoveryId) return;
    setRecovering(true);
    try {
      const preserved = await request(
        `/v1/scripts/${scriptId}/versions/${number}/collaboration/conflicts/${recoveryId}`,
        z.object({ document: ScriptDocumentSchema }),
      );
      store.applyRemote(preserved.document);
      // Keep the local copy detached and dirty. Publication still requires a normal authorized draft.
      store.setWriteSuspended(true);
      setStatus('recovered');
    } catch {
      setStatus('conflict');
    } finally {
      setRecovering(false);
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
        {[...new Map(peers.map((peer) => [peer.userId, peer])).values()].map((peer) => {
          const name = nameOf(peer.userId);
          const pressed = following === peer.userId;
          return (
            <Button
              key={peer.userId}
              variant="ghost"
              size="sm"
              className="lc-peer-follow"
              data-tone={peerTone(peer.userId)}
              aria-pressed={pressed}
              aria-label={t(
                pressed ? 'designer.collaboration.stopFollowing' : 'designer.collaboration.follow',
                { name },
              )}
              title={t(
                pressed ? 'designer.collaboration.stopFollowing' : 'designer.collaboration.follow',
                { name },
              )}
              onClick={() => {
                setFollowing(pressed ? null : peer.userId);
                setFollowNotice(
                  t(
                    pressed
                      ? 'designer.collaboration.followStopped'
                      : 'designer.collaboration.following',
                    { name },
                  ),
                );
              }}
            >
              <Avatar name={name} size="sm" />
            </Button>
          );
        })}
        <span className="vb-sr-only" role="status">
          {followNotice}
        </span>
        <Badge
          tone={
            status === 'connected'
              ? 'success'
              : status === 'conflict' || status === 'failed'
                ? 'danger'
                : 'info'
          }
        >
          {t(`designer.lifecycle.connection.${status === 'recovered' ? 'conflict' : status}`)}
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
      {recoveryId && (
        <Button loading={recovering} onClick={() => void recover()}>
          {t('designer.editor.recoverConflict')}
        </Button>
      )}
      {status === 'recovered' && (
        <>
          <Alert tone="info" title={t('designer.editor.conflictRecovered')} />
          <Button
            loading={recovering}
            disabled={!ability.can('create', 'Script')}
            onClick={() => void createRecovery()}
          >
            {t('designer.editor.createRecoveryDraft')}
          </Button>
        </>
      )}
      {open && (
        <>
          <p>{t('designer.lifecycle.collaborationHelp')}</p>
          {!!recoveries.data?.length && (
            <Select
              label={t('designer.editor.preservedEdits')}
              value={recoveryId ?? ''}
              options={recoveries.data.map((copy) => ({
                value: copy.id,
                label: `${copy.baseVersion} → ${copy.currentVersion} · ${new Date(copy.createdAt).toLocaleString()}`,
              }))}
              onValueChange={setRecoveryId}
            />
          )}
          <Comments scriptId={scriptId} number={number} nodeId={state.selection[0] ?? 'script'} />
          <Suggestions
            scriptId={scriptId}
            number={number}
            document={state.document}
            onAccepted={() => {
              window.location.reload();
            }}
          />
        </>
      )}
    </>
  );
}
