import { describe, expect, it } from 'vitest';

import { buildReplay, type ReplayEvent } from './replay.js';

const t0 = Date.parse('2026-10-07T10:00:00.000Z');
const ev = (seq: number, ms: number, type: string, payload: unknown = {}): ReplayEvent => ({
  seq,
  type,
  payload,
  occurredAt: new Date(t0 + ms),
});
const pages = [
  { id: 'welcome', name: 'Welcome' },
  { id: 'offer', name: 'Offer' },
  { id: 'wrap', name: 'Wrap-up' },
];

describe('buildReplay', () => {
  it('reconstructs the path with dwell times and the pages never reached', () => {
    const replay = buildReplay(
      [
        ev(1, 0, 'page.entered', { pageId: 'welcome' }),
        ev(2, 4000, 'field.changed', { variable: 'segment', value: 'gold' }),
        ev(3, 6000, 'page.entered', { pageId: 'offer' }),
        ev(4, 9000, 'page.entered', { pageId: 'welcome' }),
        ev(5, 10000, 'session.transitioned', { from: 'active', to: 'completed' }),
      ],
      pages,
      100,
    );
    expect(replay.durationMs).toBe(10000);
    expect(replay.pages).toEqual([
      { pageId: 'welcome', name: 'Welcome', visits: 2, dwellMs: 6000 + 1000 },
      { pageId: 'offer', name: 'Offer', visits: 1, dwellMs: 3000 },
    ]);
    expect(replay.unreached).toEqual([{ id: 'wrap', name: 'Wrap-up' }]);
    expect(replay.steps.map((s) => [s.seq, s.atMs, s.kind])).toEqual([
      [1, 0, 'page'],
      [2, 4000, 'field'],
      [3, 6000, 'page'],
      [4, 9000, 'page'],
      [5, 10000, 'state'],
    ]);
    expect(replay.truncated).toBe(false);
  });

  it('keeps counting dwell time on active/wrapup transitions but stops it when the session ends', () => {
    const replay = buildReplay(
      [
        ev(1, 0, 'page.entered', { pageId: 'welcome' }),
        ev(2, 2000, 'session.transitioned', { from: 'active', to: 'wrapup' }),
        ev(3, 5000, 'session.transitioned', { from: 'wrapup', to: 'abandoned' }),
        ev(4, 9000, 'timer.started', { timerId: 't1' }),
      ],
      pages,
      100,
    );
    expect(replay.pages).toEqual([
      { pageId: 'welcome', name: 'Welcome', visits: 1, dwellMs: 5000 },
    ]);
    expect(replay.steps.at(-1)).toMatchObject({ kind: 'timer', timerId: 't1' });
  });

  it('shows runtime-stored values, collapses structures, and never copies unknown payloads', () => {
    const long = 'x'.repeat(300);
    const replay = buildReplay(
      [
        ev(1, 0, 'field.changed', { variable: 'a', value: '[REDACTED]' }),
        ev(2, 1, 'field.changed', { variable: 'b', value: 42 }),
        ev(3, 2, 'field.changed', { variable: 'c', value: { nested: 'secret' } }),
        ev(4, 3, 'field.changed', { variable: 'd', value: long }),
        ev(5, 4, 'field.changed', { variable: 'e', value: null }),
        ev(6, 5, 'outcome.submitted', { code: 'SALE', note: 'customer said private things' }),
      ],
      pages,
      100,
    );
    expect(replay.steps).toEqual([
      { seq: 1, atMs: 0, kind: 'field', variable: 'a', value: '[REDACTED]' },
      { seq: 2, atMs: 1, kind: 'field', variable: 'b', value: '42' },
      { seq: 3, atMs: 2, kind: 'field', variable: 'c', value: '[…]' },
      { seq: 4, atMs: 3, kind: 'field', variable: 'd', value: `${'x'.repeat(200)}…` },
      { seq: 5, atMs: 4, kind: 'field', variable: 'e', value: 'null' },
      { seq: 6, atMs: 5, kind: 'other', type: 'outcome.submitted' },
    ]);
    expect(JSON.stringify(replay)).not.toContain('private things');
  });

  it('ignores malformed events, sorts by sequence, names unknown pages by id and caps the list', () => {
    const replay = buildReplay(
      [
        ev(3, 3000, 'page.entered', { pageId: 'gone' }),
        ev(1, 0, 'page.entered', {}),
        ev(2, 1000, 'field.changed', { value: 'no variable' }),
        ev(4, 4000, 'session.transitioned', { from: 'active' }),
        ev(5, 5000, 'timer.started', {}),
        ev(6, 6000, 'page.entered', { pageId: 'offer' }),
      ],
      pages,
      4,
    );
    expect(replay.steps.map((s) => s.seq)).toEqual([3]);
    expect(replay.pages).toEqual([{ pageId: 'gone', name: 'gone', visits: 1, dwellMs: 1000 }]);
    expect(replay.truncated).toBe(true);
    expect(replay.durationMs).toBe(4000);
    expect(buildReplay([], pages, 10)).toEqual({
      durationMs: 0,
      steps: [],
      pages: [],
      unreached: pages,
      truncated: false,
    });
  });
});
