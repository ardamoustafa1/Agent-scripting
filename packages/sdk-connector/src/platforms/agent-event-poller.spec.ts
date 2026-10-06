import { expect, it, vi } from 'vitest';

import { AgentEventPoller } from './agent-event-poller.js';

it('retains the batch on backpressure and commits the cursor only after all events', async () => {
  const api = {
    next: vi.fn().mockResolvedValue({ cursor: 'cursor-2', events: ['a', 'b'] }),
    commit: vi.fn().mockResolvedValue(undefined),
  };
  const seen: unknown[] = [];
  let blocked = true;
  const poller = new AgentEventPoller(api, (event) => {
    if (event === 'b' && blocked) return Promise.reject(new Error('backpressure'));
    seen.push(event);
    return Promise.resolve();
  });
  const signal = new AbortController().signal;
  await expect(poller.pollOnce(signal)).rejects.toThrow('backpressure');
  expect(api.commit).not.toHaveBeenCalled();
  blocked = false;
  await poller.pollOnce(signal);
  expect(seen).toEqual(['a', 'b']);
  expect(api.next).toHaveBeenCalledTimes(1);
  expect(api.commit).toHaveBeenCalledWith('cursor-2');
});

it('does not commit an aborted partial batch and rejects concurrent polling', async () => {
  const abort = new AbortController();
  let release: (() => void) | undefined;
  const next = vi.fn().mockImplementation(
    () =>
      new Promise((resolve) => {
        release = () => {
          resolve({ cursor: 'next', events: ['first', 'second'] });
        };
      }),
  );
  const commit = vi.fn(),
    publish = vi.fn();
  const poller = new AgentEventPoller({ next, commit }, publish);
  const active = poller.pollOnce(abort.signal);
  await expect(poller.pollOnce(abort.signal)).rejects.toThrow('Poll already in progress');
  abort.abort();
  release?.();
  await active;
  expect(commit).not.toHaveBeenCalled();
  expect(publish).not.toHaveBeenCalled();
  await poller.pollOnce(new AbortController().signal);
  expect(next).toHaveBeenCalledOnce();
  expect(publish.mock.calls).toEqual([['first'], ['second']]);
  expect(commit).toHaveBeenCalledWith('next');
});
