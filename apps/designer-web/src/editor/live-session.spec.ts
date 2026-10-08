import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PageSchema,
  ScriptDocumentSchema,
  VariableSchema,
  type ScriptDocument,
} from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';

import { LiveSession } from './live-session.js';

/** home → second → end; `second` stamps `entered` on entry so replays are observable. */
function twoPages(edit: (doc: ScriptDocument) => void = () => undefined): ScriptDocument {
  const doc = ScriptDocumentSchema.parse(minimalScript());
  doc.variables.push(
    VariableSchema.parse({
      key: 'note',
      type: 'string',
      scope: 'session',
      default: '',
    }),
    VariableSchema.parse({
      key: 'entered',
      type: 'string',
      scope: 'session',
      default: '',
    }),
  );
  doc.pages.push(
    PageSchema.parse({
      id: 'second',
      name: 'Second',
      layout: { id: 'second-root', type: 'box' },
      onEnter: [{ type: 'setVariable', variable: 'entered', value: 'yes' }],
    }),
  );
  doc.flow.nodes.splice(1, 0, { id: 'n-second', type: 'page', page: 'second' });
  doc.flow.edges = [
    { id: 'e1', from: 'n-home', to: 'n-second' },
    { id: 'e2', from: 'n-second', to: 'n-end' },
  ];
  edit(doc);
  return doc;
}

const sessions: LiveSession[] = [];
afterEach(() => {
  sessions.splice(0).forEach((s) => {
    s.dispose();
  });
});
function open(document = twoPages()) {
  let clock = 0;
  const session = new LiveSession('tr', () => (clock += 5));
  sessions.push(session);
  expect(session.load(document)).toBe('started');
  return session;
}
const page = (session: LiveSession) => session.runtime?.store.get('runtime.page');
async function atSecond(session: LiveSession) {
  await vi.waitFor(() => {
    expect(page(session)).toBe('home');
  });
  session.runtime?.store.setVariable('note', 'customer asked about roaming');
  await session.runtime?.next();
  await vi.waitFor(() => {
    expect(page(session)).toBe('second');
  });
}

describe('LiveSession', () => {
  it('starts the flow on first load and reports load time from the injected clock', async () => {
    const session = open();
    await vi.waitFor(() => {
      expect(page(session)).toBe('home');
    });
    expect(session.loadMs).toBe(5);
  });

  it('keeps the page and entered values across an edit without replaying entry actions', async () => {
    const session = open();
    await atSecond(session);
    session.runtime?.store.setVariable('entered', 'changed by agent');

    const result = session.load(
      twoPages((doc) => {
        doc.meta.name = 'Edited';
      }),
    );

    expect(result).toBe('reloaded');
    expect(page(session)).toBe('second');
    expect(session.runtime?.store.variable('note')).toBe('customer asked about roaming');
    // onEnter would have reset this to "yes".
    expect(session.runtime?.store.variable('entered')).toBe('changed by agent');
  });

  it('shows a new default at once for values the agent never touched', async () => {
    const session = open();
    await vi.waitFor(() => {
      expect(page(session)).toBe('home');
    });
    session.load(
      twoPages((doc) => {
        const note = doc.variables.find((v) => v.key === 'note');
        if (note) note.default = 'new default';
      }),
    );
    expect(session.runtime?.store.variable('note')).toBe('new default');
  });

  it('drops values whose variable was removed or changed type', async () => {
    const session = open();
    await atSecond(session);
    const result = session.load(
      twoPages((doc) => {
        const note = doc.variables.find((v) => v.key === 'note');
        if (note) note.type = 'number';
        note!.default = null;
      }),
    );
    expect(result).toBe('reloaded');
    expect(session.runtime?.store.variable('note')).toBeNull();
  });

  it('restarts from the flow start when the current page is deleted', async () => {
    const session = open();
    await atSecond(session);
    const result = session.load(
      twoPages((doc) => {
        doc.pages = doc.pages.filter((p) => p.id !== 'second');
        doc.flow.nodes = doc.flow.nodes.filter((n) => n.id !== 'n-second');
        doc.flow.edges = [{ id: 'e1', from: 'n-home', to: 'n-end' }];
      }),
    );
    expect(result).toBe('started');
    await vi.waitFor(() => {
      expect(page(session)).toBe('home');
    });
    expect(session.runtime?.store.variable('note')).toBe('customer asked about roaming');
  });

  it('restarts when the page still exists but left the flow', async () => {
    const session = open();
    await atSecond(session);
    const result = session.load(
      twoPages((doc) => {
        doc.flow.nodes = doc.flow.nodes.filter((n) => n.id !== 'n-second');
        doc.flow.edges = [{ id: 'e1', from: 'n-home', to: 'n-end' }];
      }),
    );
    expect(result).toBe('restarted');
    await vi.waitFor(() => {
      expect(page(session)).toBe('home');
    });
  });

  it('restart discards entered values', async () => {
    const session = open();
    await atSecond(session);
    session.restart();
    await vi.waitFor(() => {
      expect(page(session)).toBe('home');
    });
    expect(session.runtime?.store.variable('note')).toBe('');
  });

  it('show() moves to a page without running its entry actions', async () => {
    const session = open();
    await vi.waitFor(() => {
      expect(page(session)).toBe('home');
    });
    session.show('second');
    expect(page(session)).toBe('second');
    expect(session.runtime?.store.variable('entered')).toBe('');
  });

  it('switches locale with a state-preserving reload', async () => {
    const session = open();
    await atSecond(session);
    session.setLocale('en');
    expect(session.result).toBe('reloaded');
    expect(session.runtime?.store.locale).toBe('en');
    expect(page(session)).toBe('second');
    expect(session.runtime?.store.variable('note')).toBe('customer asked about roaming');
    session.load(twoPages());
    expect(session.runtime?.store.locale).toBe('en');
  });

  it('reports failure for a document the runtime rejects and recovers on the next valid edit', async () => {
    const session = new LiveSession('tr');
    sessions.push(session);
    expect(
      session.load(
        twoPages((doc) => {
          doc.flow.start = 'n-missing';
        }),
      ),
    ).toBe('failed');
    expect(session.runtime).toBeNull();
    expect(session.load(twoPages())).toBe('started');
    await vi.waitFor(() => {
      expect(page(session)).toBe('home');
    });
  });

  it('notifies subscribers on load and on page changes', async () => {
    const session = open();
    const listener = vi.fn();
    session.subscribe(listener);
    await atSecond(session);
    expect(listener).toHaveBeenCalled();
    const before = session.getSnapshot();
    session.load(twoPages());
    expect(session.getSnapshot()).toBeGreaterThan(before);
  });
});
