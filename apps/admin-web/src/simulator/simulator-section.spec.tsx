import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';

import { mountAdmin } from '../workspace/fixtures.spec.helpers.js';

import { SimulatorSection } from './simulator-section.js';

const page = (data: unknown[]) => ({
  data,
  page: { limit: 100, nextCursor: null, sort: '-createdAt' },
});
const generic = { id: 'c1', adapterType: 'generic', status: 'active', health: {} };

it('explains that a Simulator connector is needed when the only connector is not a simulator', async () => {
  // The API never returns `config`; a schema that required it used to blank the whole page.
  const f = await mountAdmin(<SimulatorSection csrfToken="t" />, {
    '/v1/connectors?limit=100': page([generic]),
  });
  expect(await screen.findByText(f.i18n.t('admin.simulator.noConnector'))).toBeTruthy();
  expect(screen.queryByRole('button', { name: f.i18n.t('admin.simulator.create') })).toBeNull();
});

it('shows the new-interaction form once an active simulator connector exists', async () => {
  const f = await mountAdmin(<SimulatorSection csrfToken="t" />, {
    '/v1/connectors?limit=100': page([{ ...generic, kind: 'simulator' }]),
    '/v1/simulator/connectors/c1': { interactions: [], commands: [] },
  });
  expect(
    await screen.findByRole('button', { name: f.i18n.t('admin.simulator.create') }),
  ).toBeTruthy();
});

it('tells the operator when the connector list cannot be loaded instead of staying blank', async () => {
  const f = await mountAdmin(<SimulatorSection csrfToken="t" />, {
    '/v1/connectors?limit=100': Response.json({ code: 'VERBIS_X' }, { status: 500 }),
  });
  expect((await screen.findByRole('alert')).textContent).toBe(
    f.i18n.t('admin.simulator.error.generic'),
  );
});

const call = (channel: string) => ({
  platformInteractionId: `sim-${channel}`,
  channel,
  direction: 'inbound',
  agentPlatformUserId: 'agent-1',
  status: 'connected',
  context: {},
  attributes: {},
  createdAt: '2026-10-22T10:00:00.000Z',
  updatedAt: '2026-10-22T10:00:00.000Z',
});

it('speaks a line on a voice call as a transcript utterance with its speaker', async () => {
  const f = await mountAdmin(<SimulatorSection csrfToken="t" />, {
    '/v1/connectors?limit=100': page([{ ...generic, kind: 'simulator' }]),
    '/v1/simulator/connectors/c1': { interactions: [call('voice'), call('chat')], commands: [] },
    '/v1/simulator/connectors/c1/interactions/sim-voice/actions': call('voice'),
  });
  const says = (action: string, channel: string) =>
    screen.queryByRole('button', {
      name: f.i18n.t('admin.simulator.actionFor', {
        action: f.i18n.t(`admin.simulator.action.${action}`),
        channel: f.i18n.t(`admin.simulator.channel.${channel}`),
        agent: 'agent-1',
      }),
    });
  await waitFor(() => {
    expect(says('customerSays', 'voice')).toBeTruthy();
  });
  // Chat has no spoken lines; both keep the written customer message.
  expect(says('customerSays', 'chat')).toBeNull();
  expect(says('customerMessage', 'chat')).toBeTruthy();
  expect(says('customerSays', 'voice')?.hasAttribute('disabled')).toBe(true);
  fireEvent.change(screen.getByLabelText(f.i18n.t('admin.simulator.field.customerMessage')), {
    target: { value: 'Aboneliğimi iptal etmek istiyorum' },
  });
  fireEvent.click(says('agentSays', 'voice')!);
  await waitFor(() => {
    expect(f.requests.find((r) => r.method === 'POST')).toMatchObject({
      path: '/v1/simulator/connectors/c1/interactions/sim-voice/actions',
      body: { action: 'utterance', speaker: 'agent', message: 'Aboneliğimi iptal etmek istiyorum' },
    });
  });
});
