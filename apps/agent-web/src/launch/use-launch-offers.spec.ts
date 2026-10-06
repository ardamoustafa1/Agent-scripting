import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { fetchAgentSession, LaunchApiError } from './launch-api.js';
import { useLaunchOffers } from './use-launch-offers.js';

import type * as LaunchApi from './launch-api.js';

const socket = vi.hoisted(() => ({ handlers: new Map<string, () => void>(), disconnect: vi.fn() }));
vi.mock('socket.io-client', () => ({
  io: () => ({
    on: (name: string, fn: () => void) => socket.handlers.set(name, fn),
    disconnect: socket.disconnect,
  }),
}));
vi.mock('./launch-api.js', async (original) => ({
  ...(await original<typeof LaunchApi>()),
  fetchAgentSession: vi.fn(),
}));
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  socket.handlers.clear();
});
it('shows a session-fetch failure and reconnects after backoff instead of remaining connecting', async () => {
  vi.useFakeTimers();
  const failure = new LaunchApiError('VERBIS_HTTP_UNAVAILABLE');
  vi.mocked(fetchAgentSession)
    .mockRejectedValueOnce(failure)
    .mockResolvedValue({
      user: { id: 'agent', tenantId: 'tenant', authMethod: 'sso' },
      csrfToken: 'synthetic',
    });
  const onFailure = vi.fn();
  const navigate = vi.fn();
  const hook = renderHook(() => useLaunchOffers(true, navigate, onFailure));
  await act(async () => {
    await Promise.resolve();
  });
  expect(hook.result.current).toBe('disconnected');
  expect(onFailure).toHaveBeenCalledWith(failure);
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(fetchAgentSession).toHaveBeenCalledTimes(2);
  act(() => socket.handlers.get('connect')?.());
  expect(hook.result.current).toBe('connected');
  hook.unmount();
  expect(socket.disconnect).toHaveBeenCalledOnce();
});
it('cancels pending session retries when the workspace unmounts', async () => {
  vi.useFakeTimers();
  vi.mocked(fetchAgentSession).mockRejectedValue(new Error('private network detail'));
  const navigate = vi.fn();
  const hook = renderHook(() => useLaunchOffers(true, navigate));
  await act(async () => {
    await Promise.resolve();
  });
  hook.unmount();
  await vi.advanceTimersByTimeAsync(30000);
  expect(fetchAgentSession).toHaveBeenCalledOnce();
});
