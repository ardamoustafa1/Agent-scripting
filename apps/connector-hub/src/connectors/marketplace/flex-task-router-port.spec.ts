import { describe, expect, it } from 'vitest';

import {
  createFlexTaskRouterPort,
  type FlexTaskRouterApi,
  type FlexTaskSnapshot,
} from './flex-task-router-port.js';

class FakeTaskRouter implements FlexTaskRouterApi {
  revision = 1;
  attributes: Record<string, unknown> = { a: 1 };
  /** Simulates a concurrent writer: called before the next update is evaluated. */
  interfere: (() => void) | undefined;
  readonly updates: { attributes: Record<string, unknown>; ifMatch: string }[] = [];
  getTask(id: string): Promise<FlexTaskSnapshot | undefined> {
    return Promise.resolve(
      id === 'WT1'
        ? { attributes: { ...this.attributes }, etag: `"rev-${String(this.revision)}"` }
        : undefined,
    );
  }
  updateTask(
    _id: string,
    attributes: Record<string, unknown>,
    ifMatch: string,
  ): Promise<{ status: 'ok' } | { status: 'precondition-failed' }> {
    this.interfere?.();
    this.interfere = undefined;
    this.updates.push({ attributes, ifMatch });
    if (ifMatch !== `"rev-${String(this.revision)}"`)
      return Promise.resolve({ status: 'precondition-failed' });
    this.attributes = attributes;
    this.revision += 1;
    return Promise.resolve({ status: 'ok' });
  }
  complete = (): Promise<void> => Promise.resolve();
  verifyParticipant = (): Promise<boolean> => Promise.resolve(true);
}
const write = (attributes: Record<string, string>) => ({
  type: 'writeAttributes' as const,
  commandId: 'c1',
  interactionId: 'WT1',
  platform: 'twilio-flex' as const,
  attributes,
});

describe('Twilio Flex conditional task updates (M-26, unverified against vendor)', () => {
  it('sends If-Match with the ETag it read and merges attributes', async () => {
    const api = new FakeTaskRouter();
    await createFlexTaskRouterPort(api).execute(write({ b: '2' }));
    expect(api.updates).toEqual([{ attributes: { a: 1, b: '2' }, ifMatch: '"rev-1"' }]);
    expect(api.attributes).toEqual({ a: 1, b: '2' });
  });
  it('re-reads and retries once on 412 so a concurrent write is merged, not lost', async () => {
    const api = new FakeTaskRouter();
    api.interfere = () => {
      api.attributes = { ...api.attributes, other: 'x' };
      api.revision += 1;
    };
    await createFlexTaskRouterPort(api).execute(write({ b: '2' }));
    expect(api.updates).toHaveLength(2);
    expect(api.attributes).toEqual({ a: 1, other: 'x', b: '2' });
  });
  it('fails retryably after repeated 412 and never writes without If-Match', async () => {
    const api = new FakeTaskRouter();
    api.updateTask = (_id, attributes, ifMatch) => {
      api.updates.push({ attributes, ifMatch });
      return Promise.resolve({ status: 'precondition-failed' });
    };
    await expect(createFlexTaskRouterPort(api).execute(write({ b: '2' }))).rejects.toMatchObject({
      code: 'task_conflict',
      retryable: true,
    });
    expect(api.updates).toHaveLength(3);
    expect(api.updates.every((u) => u.ifMatch.length > 0)).toBe(true);
  });
  it('refuses to write when the task has no ETag', async () => {
    const api = new FakeTaskRouter();
    api.getTask = () => Promise.resolve({ attributes: {}, etag: '' });
    await expect(createFlexTaskRouterPort(api).execute(write({ b: '2' }))).rejects.toMatchObject({
      code: 'task_etag_missing',
    });
  });
  it('rejects unknown tasks', async () => {
    const api = new FakeTaskRouter();
    await expect(
      createFlexTaskRouterPort(api).execute({ ...write({ b: '2' }), interactionId: 'nope' }),
    ).rejects.toThrow();
  });
});
