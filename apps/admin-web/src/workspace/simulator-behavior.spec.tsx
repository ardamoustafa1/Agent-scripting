import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';

import { type SimInteraction } from '../simulator/simulator-api.js';

import { mountAdmin, syntheticId } from './fixtures.spec.helpers.js';
import { Simulator } from './operations-pages.js';

const base = `/v1/simulator/connectors/${syntheticId}`;
const eligible = {
  id: syntheticId,
  adapterType: 'generic',
  status: 'active',
  config: { kind: 'simulator' },
};
async function setup(interactions: SimInteraction[] = [], extra: Record<string, unknown> = {}) {
  const f = await mountAdmin(<Simulator />, {
    '/v1/connectors?limit=100': { data: [eligible] },
    [base]: { interactions, commands: [] },
    ...extra,
  });
  const label = (key: string) => f.i18n.t(`admin.simulator.${key}`);
  await screen.findByRole('button', { name: label('create') });
  return { ...f, label };
}
it('creates an email simulation with optional fields and CSRF, then omits cleared optional fields', async () => {
  const f = await setup();
  const change = (name: string, value: string) =>
    fireEvent.change(screen.getByLabelText(f.label(`field.${name}`)), { target: { value } });
  change('channel', 'email');
  change('agentPlatformUserId', 'synthetic-agent');
  change('agentEmail', 'agent@example.test');
  change('customerName', 'Synthetic customer');
  change('subject', 'Synthetic subject');
  change('message', 'Synthetic message');
  fireEvent.click(screen.getByLabelText(f.label('field.autoConnect')));
  fireEvent.submit(screen.getByLabelText(f.label('field.agentPlatformUserId')).closest('form')!);
  await waitFor(() => {
    expect(f.requests.filter((r) => r.method === 'POST')).toHaveLength(1);
  });
  const request = f.requests.find((r) => r.method === 'POST')!;
  expect(request.path).toBe(`${base}/interactions`);
  expect(request.body).toEqual({
    channel: 'email',
    agentPlatformUserId: 'synthetic-agent',
    agentEmail: 'agent@example.test',
    customerName: 'Synthetic customer',
    subject: 'Synthetic subject',
    message: 'Synthetic message',
    autoConnect: true,
  });
  expect(new Headers(request.init?.headers).get('x-csrf-token')).toBe('synthetic-csrf');
  await waitFor(() => {
    expect(screen.getByRole('button', { name: f.label('create') }).hasAttribute('disabled')).toBe(
      false,
    );
  });
  for (const name of ['agentEmail', 'customerName', 'subject', 'message']) change(name, '');
  change('channel', 'chat');
  fireEvent.click(screen.getByLabelText(f.label('field.autoConnect')));
  fireEvent.submit(screen.getByLabelText(f.label('field.agentPlatformUserId')).closest('form')!);
  await waitFor(() => {
    expect(f.requests.filter((r) => r.method === 'POST')).toHaveLength(2);
  });
  expect(f.requests.filter((r) => r.method === 'POST')[1]!.body).toEqual({
    channel: 'chat',
    agentPlatformUserId: 'synthetic-agent',
    autoConnect: false,
  });
  expect(screen.queryByLabelText(f.label('field.subject'))).toBeNull();
});
it('limits actions by interaction status and sends customer messages and transfer targets', async () => {
  const statuses = ['alerting', 'connected', 'held', 'transferred', 'wrapup', 'ended'] as const;
  const f = await setup(
    statuses.map((status) => ({
      platformInteractionId: `pid-${status}`,
      agentPlatformUserId: `agent-${status}`,
      channel: 'chat',
      status,
      updatedAt: '2026-10-03T12:00:00Z',
    })),
    {
      [base]: {
        interactions: statuses.map((status) => ({
          platformInteractionId: `pid-${status}`,
          agentPlatformUserId: `agent-${status}`,
          channel: 'chat',
          status,
          updatedAt: '2026-10-03T12:00:00Z',
        })),
        commands: [
          {
            commandId: 'command-1',
            command: 'synthetic-command',
            platformInteractionId: 'pid-connected',
            at: '2026-10-03T12:00:00Z',
          },
        ],
      },
    },
  );
  await screen.findByText('agent-connected');
  const allowed = {
    alerting: ['connect', 'end'],
    connected: ['hold', 'customerMessage', 'transfer', 'wrapup', 'end'],
    held: ['resume', 'transfer', 'end'],
    transferred: ['connect', 'end'],
    wrapup: ['end'],
    ended: [],
  };
  for (const status of statuses) {
    const row = within(screen.getByText(`agent-${status}`).closest('tr')!);
    expect(row.queryAllByRole('button').map((button) => button.textContent)).toEqual(
      allowed[status].map((action) => f.label(`action.${action}`)),
    );
  }
  const row = within(screen.getByText('agent-connected').closest('tr')!);
  const button = (action: string) =>
    row.getByRole('button', {
      name: f.i18n.t('admin.simulator.actionFor', {
        action: f.label(`action.${action}`),
        channel: f.label('channel.chat'),
        agent: 'agent-connected',
      }),
    });
  expect(button('transfer').hasAttribute('disabled')).toBe(true);
  fireEvent.change(screen.getByLabelText(f.label('field.transferTo')), {
    target: { value: 'target-agent' },
  });
  fireEvent.change(screen.getByLabelText(f.label('field.customerMessage')), {
    target: { value: 'Synthetic customer reply' },
  });
  for (const action of ['customerMessage', 'transfer', 'hold', 'wrapup', 'end']) {
    await waitFor(() => {
      expect(button(action).hasAttribute('disabled')).toBe(false);
    });
    fireEvent.click(button(action));
    await waitFor(() => {
      expect(
        f.requests.some(
          (r) => r.method === 'POST' && (r.body as { action?: string }).action === action,
        ),
      ).toBe(true);
    });
  }
  const posts = f.requests.filter((r) => r.method === 'POST');
  expect(posts[0]!.body).toEqual({
    action: 'customerMessage',
    message: 'Synthetic customer reply',
  });
  expect(posts[1]!.body).toEqual({ action: 'transfer', transferToPlatformUserId: 'target-agent' });
  expect(posts.every((r) => r.path === `${base}/interactions/pid-connected/actions`)).toBe(true);
  expect(screen.getByText(/synthetic-command/)).toBeTruthy();
});
it.each([
  ['VERBIS_RESOURCE_NOT_FOUND', 'disabled'],
  ['VERBIS_VALIDATION_FAILED', 'rejected'],
  ['VERBIS_HTTP_UNAVAILABLE', 'generic'],
])('explains rejected simulator creation: %s', async (code, key) => {
  const f = await setup([], {
    [`POST ${base}/interactions`]: Response.json({ code }, { status: 409 }),
  });
  fireEvent.change(screen.getByLabelText(f.label('field.agentPlatformUserId')), {
    target: { value: 'synthetic-agent' },
  });
  fireEvent.submit(screen.getByLabelText(f.label('field.agentPlatformUserId')).closest('form')!);
  expect((await screen.findByRole('alert')).textContent).toContain(f.label(`error.${key}`));
  expect(screen.getByText(f.label('empty'))).toBeTruthy();
  expect(screen.getByText(f.label('noCommands'))).toBeTruthy();
});
it('shows disabled simulator when every connector is ineligible', async () => {
  const f = await mountAdmin(<Simulator />, {
    '/v1/connectors?limit=100': {
      data: [
        { ...eligible, adapterType: 'genesys' },
        { ...eligible, status: 'disabled' },
        { ...eligible, config: null },
        { ...eligible, config: { kind: 'other' } },
      ],
    },
  });
  expect((await screen.findByRole('status')).textContent).toContain(
    f.i18n.t('admin.simulator.noConnector'),
  );
  expect(screen.queryByRole('button')).toBeNull();
  expect(f.requests.every((r) => !r.path.startsWith('/v1/simulator'))).toBe(true);
});
