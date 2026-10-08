import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import {
  initializeDocument,
  applyDocumentChange,
  readDocument,
  LOCAL_EDIT,
  Y,
} from '@verbis/collaboration';
import { minimalScript } from '@verbis/script-schema/fixtures';

import { EditorStore } from '../editor/store.js';
import { mountDesigner } from '../fixtures.spec.helpers.js';
import { RuleManager } from '../rules/manager.js';
import { campaignId, scriptId, sessionFixture } from '../test-fixtures.js';

import { CollaborationPanel } from './collaboration.js';

interface Options {
  document: Y.Doc;
  token: () => Promise<string>;
  onSynced: () => void;
  onAuthenticationFailed: () => void;
  onDisconnect: () => void;
  onAwarenessChange: () => void;
  onStateless: (event: { payload: string }) => void;
}
const transport = vi.hoisted(() => ({
  instances: [] as {
    options: Options;
    states: Map<number, unknown>;
    fields: Map<string, unknown>;
    destroy: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }[],
}));
vi.mock('@hocuspocus/provider', () => ({
  HocuspocusProvider: class {
    awareness: { getStates: () => Map<number, unknown> };
    fields = new Map<string, unknown>();
    destroy = vi.fn();
    disconnect: ReturnType<typeof vi.fn>;
    constructor(options: Options) {
      const states = new Map<number, unknown>();
      this.awareness = { getStates: () => states };
      this.disconnect = vi.fn(() => {
        options.onDisconnect();
      });
      transport.instances.push({
        options,
        states,
        fields: this.fields,
        destroy: this.destroy,
        disconnect: this.disconnect,
      });
    }
    setAwarenessField(key: string, value: unknown) {
      this.fields.set(key, value);
    }
  },
}));
async function setup() {
  const store = new EditorStore(minimalScript()),
    saved = vi.fn(),
    active = vi.fn();
  const f = await mountDesigner(
    <>
      <div className="ed-canvas">
        <div data-editor-node="btn-next">
          <button>Synthetic canvas</button>
        </div>
      </div>
      <CollaborationPanel
        store={store}
        scriptId={scriptId}
        number={1}
        ready
        onSaved={saved}
        onActive={active}
      />
    </>,
    {
      [`/v1/scripts/${scriptId}/versions/1/collaboration/ticket`]: {
        ticket: 'synthetic-ticket',
        documentName: 'synthetic-document',
        userId: sessionFixture.user.id,
        path: '/collaboration',
      },
      [`/v1/scripts/${scriptId}/versions/1/team-members`]: [
        { id: campaignId, name: 'Synthetic peer' },
      ],
    },
  );
  fireEvent.click(screen.getByRole('button', { name: f.label('lifecycle.join') }));
  await waitFor(() => {
    expect(active).toHaveBeenCalledWith(true);
  });
  const socket = transport.instances.at(-1)!;
  act(() => {
    initializeDocument(socket.options.document, store.getSnapshot().document);
    socket.options.onSynced();
  });
  return { ...f, store, saved, active, socket };
}
it('suspends writes until sync, authenticates through BFF and publishes local changes into real Yjs', async () => {
  const f = await setup();
  expect(await f.socket.options.token()).toBe('synthetic-ticket');
  expect(f.requests.find((r) => r.method === 'POST')!.init?.credentials).toBe('same-origin');
  expect(f.store.getSnapshot().writeSuspended).toBe(false);
  act(() => {
    f.store.insert('box', 'home-root');
  });
  expect(readDocument(f.socket.options.document)).toEqual(f.store.getSnapshot().document);
  expect(await screen.findByText(f.label('lifecycle.connection.pending'))).toBeTruthy();
  act(() => {
    f.socket.options.onStateless({
      payload: JSON.stringify({
        type: 'saved',
        version: 8,
        stateVector: [...Y.encodeStateVector(f.socket.options.document)],
      }),
    });
  });
  expect(f.saved).toHaveBeenCalledWith(8);
  expect(await screen.findByText(f.label('lifecycle.connection.connected'))).toBeTruthy();
  act(() => {
    f.socket.options.onStateless({
      payload: JSON.stringify({ type: 'saved', version: 9, stateVector: [] }),
    });
  });
  expect(f.saved).toHaveBeenCalledOnce();
  expect(await screen.findByText(f.label('lifecycle.connection.pending'))).toBeTruthy();
});
it('applies remote document changes without echoing them and cleans up the session', async () => {
  const f = await setup();
  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(f.socket.options.document));
  const peerStore = new EditorStore(readDocument(remote));
  peerStore.insert('box', 'home-root');
  applyDocumentChange(remote, f.store.getSnapshot().document, peerStore.getSnapshot().document);
  act(() => {
    Y.applyUpdate(f.socket.options.document, Y.encodeStateAsUpdate(remote));
  });
  expect(f.store.getSnapshot().document).toEqual(peerStore.getSnapshot().document);
  f.ui.unmount();
  expect(f.socket.destroy).toHaveBeenCalledOnce();
  expect(f.store.getSnapshot().writeSuspended).toBe(false);
  expect(f.active).toHaveBeenLastCalledWith(false);
  remote.destroy();
});
it('renders only validated peer presence and selected node outlines', async () => {
  const f = await setup();
  await waitFor(() => {
    expect(f.requests.some((r) => r.path.endsWith('/team-members'))).toBe(true);
  });
  f.socket.states.set(1, {
    userId: campaignId,
    pageId: 'home',
    selection: ['btn-next', 'missing'],
    cursor: { x: 0.25, y: 0.5 },
  });
  f.socket.states.set(2, { userId: 'invalid', pageId: 'home', selection: [] });
  f.socket.states.set(f.socket.options.document.clientID, { userId: sessionFixture.user.id });
  act(() => {
    f.socket.options.onAwarenessChange();
  });
  await waitFor(() => {
    expect(document.querySelector('.lc-peer-cursor')?.textContent).toContain('Synthetic peer');
  });
  expect(document.querySelectorAll('.lc-peer-selection')).toHaveLength(1);
  expect(document.querySelectorAll('.vb-avatar')).toHaveLength(1);
});
it.each(['conflict', 'invalid'])(
  'retains %s status and rejects stale save acknowledgements',
  async (status) => {
    const f = await setup();
    act(() => {
      f.socket.options.onStateless({ payload: '{' });
      f.socket.options.onStateless({ payload: JSON.stringify({ type: status }) });
    });
    expect(await screen.findByText(f.label(`lifecycle.connection.${status}`))).toBeTruthy();
    if (status === 'conflict') expect(f.store.getSnapshot().writeSuspended).toBe(true);
    expect(f.saved).not.toHaveBeenCalled();
  },
);
it('keeps authentication failure visible after disconnect and suspends further writes', async () => {
  const f = await setup();
  act(() => {
    f.socket.options.onAuthenticationFailed();
    f.socket.options.onDisconnect();
  });
  expect(await screen.findByText(f.label('lifecycle.connection.failed'))).toBeTruthy();
  expect(f.store.getSnapshot().writeSuspended).toBe(true);
});
it('opens the team discussion and reports failed flushing without discarding local state', async () => {
  const f = await setup();
  f.responses[`/v1/scripts/${scriptId}/versions/1/collaboration/flush`] = Response.json(
    {},
    { status: 503 },
  );
  fireEvent.click(screen.getByRole('button', { name: f.label('lifecycle.team') }));
  fireEvent.click(screen.getByRole('button', { name: f.label('lifecycle.flush') }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(f.socket.destroy).not.toHaveBeenCalled();
});
it('acknowledges the persisted version before navigating away from a flushed room', async () => {
  const f = await setup();
  f.responses[`/v1/scripts/${scriptId}/versions/1/collaboration/flush`] = { closed: true };
  f.responses[`/v1/scripts/${scriptId}/versions/1`] = {
    version: 9,
    document: f.store.getSnapshot().document,
  };
  fireEvent.click(screen.getByRole('button', { name: f.label('lifecycle.flush') }));
  await waitFor(() => {
    expect(f.saved).toHaveBeenCalledWith(9);
  });
});

it('does not acknowledge or discard local changes that differ from the final persisted document', async () => {
  const f = await setup();
  const persisted = f.store.getSnapshot().document;
  act(() => {
    f.store.insert('box', 'home-root');
  });
  const edited = f.store.getSnapshot().document;
  f.responses[`/v1/scripts/${scriptId}/versions/1/collaboration/flush`] = { closed: true };
  f.responses[`/v1/scripts/${scriptId}/versions/1`] = { version: 9, document: persisted };
  fireEvent.click(screen.getByRole('button', { name: f.label('lifecycle.flush') }));
  await screen.findByRole('alert');
  expect(f.saved).not.toHaveBeenCalled();
  expect(f.store.getSnapshot().document).toEqual(edited);
});

it('converges peer rule edits after adding a rule to an initially empty shared document', async () => {
  const a = new EditorStore(minimalScript()),
    b = new EditorStore(minimalScript());
  const prior = transport.instances.length;
  const f = await mountDesigner(
    <>
      {[a, b].map((store, i) => (
        <div key={i} data-testid={`peer-${i}`}>
          <CollaborationPanel
            store={store}
            scriptId={scriptId}
            number={1}
            ready
            onSaved={() => undefined}
            onActive={() => undefined}
          />
          <RuleManager store={store} />
        </div>
      ))}
    </>,
  );
  for (const i of [0, 1])
    fireEvent.click(
      within(screen.getByTestId(`peer-${i}`)).getByRole('button', {
        name: f.label('lifecycle.join'),
      }),
    );
  await waitFor(() => {
    expect(transport.instances.length).toBe(prior + 2);
  });
  const da = transport.instances[prior]!.options.document,
    db = transport.instances[prior + 1]!.options.document;
  act(() => {
    initializeDocument(da, a.getSnapshot().document);
    Y.applyUpdate(db, Y.encodeStateAsUpdate(da));
    for (const peer of transport.instances.slice(prior)) peer.options.onSynced();
  });
  da.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === LOCAL_EDIT) Y.applyUpdate(db, update, 'peer');
  });
  db.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === LOCAL_EDIT) Y.applyUpdate(da, update, 'peer');
  });
  const first = within(screen.getByTestId('peer-0')),
    second = within(screen.getByTestId('peer-1'));
  fireEvent.click(first.getByRole('button', { name: f.label('rules.add') }));
  fireEvent.change(first.getByLabelText(f.label('rules.description')), {
    target: { value: 'Synthetic shared rule' },
  });
  fireEvent.click(second.getByRole('combobox', { name: f.label('rules.title') }));
  fireEvent.click(await screen.findByRole('option', { name: 'Synthetic shared rule' }));
  fireEvent.change(second.getByLabelText(f.label('rules.description')), {
    target: { value: 'Synthetic peer update' },
  });
  expect(first.getByLabelText<HTMLInputElement>(f.label('rules.description')).value).toBe(
    'Synthetic peer update',
  );
  expect(a.getSnapshot().document.rules).toEqual(b.getSnapshot().document.rules);
});

it('opens the preserved collaboration copy without acknowledging the newer REST draft', async () => {
  const f = await setup();
  const recoveryId = '01928f3a-0000-7000-8000-000000000049';
  const preserved = structuredClone(f.store.getSnapshot().document);
  preserved.meta.name = 'Preserved debounce edit';
  f.responses[`/v1/scripts/${scriptId}/versions/1/collaboration/conflicts/${recoveryId}`] = {
    document: preserved,
  };
  act(() => {
    f.socket.options.onStateless({ payload: JSON.stringify({ type: 'conflict', recoveryId }) });
  });
  fireEvent.click(screen.getByRole('button', { name: f.label('editor.recoverConflict') }));
  await waitFor(() => {
    expect(f.store.getSnapshot().document.meta.name).toBe('Preserved debounce edit');
  });
  expect(f.saved).not.toHaveBeenCalled();
  expect(f.store.getSnapshot().writeSuspended).toBe(true);
});

it.each([true, false])(
  'creates a recovery draft only after a successful authorized save: %s',
  async (success) => {
    const f = await setup(),
      recoveryId = '01928f3a-0000-7000-8000-000000000049';
    const preserved = structuredClone(f.store.getSnapshot().document);
    preserved.meta.name = 'Recovered local edits';
    f.responses[`/v1/scripts/${scriptId}/versions/1/collaboration/conflicts/${recoveryId}`] = {
      document: preserved,
    };
    f.responses[`POST /v1/scripts/${scriptId}/versions`] = success
      ? { number: 2, version: 1 }
      : Response.json({}, { status: 422 });
    act(() => {
      f.socket.options.onStateless({ payload: JSON.stringify({ type: 'conflict', recoveryId }) });
    });
    fireEvent.click(screen.getByRole('button', { name: f.label('editor.recoverConflict') }));
    const create = await screen.findByRole('button', {
      name: f.label('editor.createRecoveryDraft'),
    });
    fireEvent.click(create);
    await waitFor(() => {
      expect(f.requests.some((r) => r.method === 'POST' && r.path.endsWith('/versions'))).toBe(
        true,
      );
    });
    const posted = f.requests.find((r) => r.method === 'POST' && r.path.endsWith('/versions'))!;
    expect(posted.body).toEqual({ document: preserved, screens: [] });
    expect(new Headers(posted.init?.headers).get('x-csrf-token')).toBe(sessionFixture.csrfToken);
    expect(new Headers(posted.init?.headers).get('idempotency-key')).toBeTruthy();
    if (success) {
      await waitFor(() => {
        expect(f.router.state.location.pathname).toBe(`/scripts/${scriptId}/versions/2/edit`);
      });
      expect(f.saved).toHaveBeenCalledWith(1);
    } else {
      await waitFor(() => {
        expect((create as HTMLButtonElement).disabled).toBe(false);
      });
      expect(f.saved).not.toHaveBeenCalled();
      expect(f.store.getSnapshot().document).toEqual(preserved);
      expect(f.store.getSnapshot().writeSuspended).toBe(true);
    }
  },
);

it('leaves a failed initial connection and restores REST editing without losing the draft', async () => {
  const store = new EditorStore(minimalScript()),
    active = vi.fn();
  const f = await mountDesigner(
    <CollaborationPanel
      store={store}
      scriptId={scriptId}
      number={1}
      ready
      onSaved={vi.fn()}
      onActive={active}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: f.label('lifecycle.join') }));
  await waitFor(() => {
    expect(active).toHaveBeenCalledWith(true);
  });
  const socket = transport.instances.at(-1)!;
  act(() => {
    socket.options.onAuthenticationFailed();
  });
  await screen.findByRole('button', { name: f.label('lifecycle.join') });
  expect(store.getSnapshot().writeSuspended).toBe(false);
  expect(active).toHaveBeenLastCalledWith(false);
  expect(socket.destroy).toHaveBeenCalledOnce();
  expect(await screen.findByRole('alert')).toBeTruthy();
});
it('follows a colleague to their page without selecting, and stops on local input or when they leave', async () => {
  const f = await setup();
  f.store.addPage('Second page');
  const second = f.store.getSnapshot().pageId;
  f.store.setView({ pageId: 'home' });
  await waitFor(() => {
    expect(f.requests.some((r) => r.path.endsWith('/team-members'))).toBe(true);
  });
  const peer = (pageId: string) => {
    f.socket.states.set(1, { userId: campaignId, pageId, selection: ['btn-next'], cursor: null });
    act(() => {
      f.socket.options.onAwarenessChange();
    });
  };
  peer('home');
  const follow = await screen.findByRole('button', {
    name: f.i18n.t('designer.collaboration.follow', { name: 'Synthetic peer' }),
  });
  expect(follow.getAttribute('data-tone')).toMatch(
    /^(info|success|warning|primary|focus|brand-accent)$/,
  );
  fireEvent.click(follow);
  expect(follow.getAttribute('aria-pressed')).toBe('true');
  expect(
    screen.getByText(f.i18n.t('designer.collaboration.following', { name: 'Synthetic peer' })),
  ).toBeTruthy();

  peer(second);
  await waitFor(() => {
    expect(f.store.getSnapshot().pageId).toBe(second);
  });
  // Following never changes the follower's own selection.
  expect(f.store.getSnapshot().selection).toEqual([]);

  fireEvent.keyDown(document, { key: 'ArrowDown' });
  await screen.findByText(f.i18n.t('designer.collaboration.followStopped'));
  peer('home');
  expect(f.store.getSnapshot().pageId).toBe(second);

  fireEvent.click(
    screen.getByRole('button', {
      name: f.i18n.t('designer.collaboration.follow', { name: 'Synthetic peer' }),
    }),
  );
  f.socket.states.delete(1);
  act(() => {
    f.socket.options.onAwarenessChange();
  });
  await screen.findByText(
    f.i18n.t('designer.collaboration.followEnded', { name: 'Synthetic peer' }),
  );
});
