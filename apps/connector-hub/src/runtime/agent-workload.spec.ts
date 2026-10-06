import { expect, it } from 'vitest';

import { AgentWorkload } from './agent-workload.js';

it('bounds missed-end interactions and expires them without mixing tenants', () => {
  let now = 0;
  const load = new AgentWorkload({ capacity: 2, ttlMs: 60000, now: () => now });
  load.open('a', 'agent', 'one', 'chat', 1);
  load.open('a', 'agent', 'two', 'chat', 1);
  load.open('b', 'agent', 'three', 'voice', 1);
  expect(load.snapshot('a', 'agent')).toEqual({ chat: 1 });
  load.close('a', 'three');
  expect(load.snapshot('b', 'agent')).toEqual({ voice: 1 });
  now = 60001;
  expect(load.snapshot('a', 'agent')).toEqual({});
  expect(load.snapshot('b', 'agent')).toEqual({});
});
it('moves advisory workload to the receiving agent on transfer', () => {
  const load = new AgentWorkload();
  load.open('a', 'previous', 'one', 'voice', 1);
  load.open('a', 'next', 'one', 'voice', 1);
  expect(load.snapshot('a', 'previous')).toEqual({});
  expect(load.snapshot('a', 'next')).toEqual({ voice: 1 });
});
