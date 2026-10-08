import { screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';

import { mountAdmin } from './fixtures.spec.helpers.js';
import { ChannelList, EventFlow, ReadinessChecks } from './health-extras.js';

const showRows = async () => {
  const { fireEvent } = await import('@testing-library/react');
  fireEvent.click(await screen.findByRole('button', { name: /show all rows/i }));
};

it('names each dependency with a text status and shows the version', async () => {
  const f = await mountAdmin(<ReadinessChecks />, {
    '/health/ready': {
      status: 'ok',
      version: '1.2.3',
      checks: { database: { status: 'up' }, nats: { status: 'down' }, custom: { status: 'weird' } },
    },
  });
  const line = (name: string, state: string) => `${name}: ${f.label(`ops.state.${state}`)}`;
  expect(await screen.findByText(line(f.label('ops.check.database'), 'up'))).toBeTruthy();
  expect(screen.getByText(line(f.label('ops.check.nats'), 'down'))).toBeTruthy();
  // Unknown dependency keys stay readable; unknown states are "unknown", never "up".
  expect(screen.getByText(line('custom', 'unknown'))).toBeTruthy();
  expect(screen.getByText(/1\.2\.3/)).toBeTruthy();
});

it('lists processed events per day, newest first, and says when there are none', async () => {
  const f = await mountAdmin(<EventFlow />, {
    '/v1/analytics/event-counts': {
      data: [
        { eventType: 'verbis.runtime.session.started.v1', day: '2026-10-06', count: 4 },
        { eventType: 'verbis.runtime.session.started.v1', day: '2026-10-07', count: 9 },
      ],
    },
  });
  await showRows();
  const rows = within(await screen.findByRole('table')).getAllByRole('row');
  expect(rows[1]?.textContent).toContain('9');
  expect(rows[2]?.textContent).toContain('4');
  expect(f.requests[0]?.path).toBe('/v1/analytics/event-counts');
});

it('says so when no events were counted', async () => {
  const f = await mountAdmin(<EventFlow />, { '/v1/analytics/event-counts': { data: [] } });
  expect(await screen.findByText(f.label('ops.eventsNone'))).toBeTruthy();
});

it('shows channels with localized types and an explicit "not set" provider', async () => {
  const f = await mountAdmin(<ChannelList />, {
    '/v1/channels?limit=100': {
      data: [
        { id: 'a', type: 'voice', provider: 'genesys' },
        { id: 'b', type: 'whatsapp', provider: null },
      ],
    },
  });
  await showRows();
  const table = await screen.findByRole('table');
  expect(within(table).getByText(f.label('enum.channelType.voice'))).toBeTruthy();
  expect(within(table).getByText('genesys')).toBeTruthy();
  expect(within(table).getByText(f.label('ops.noProvider'))).toBeTruthy();
  expect(within(table).queryByText('voice')).toBeNull();
});

it('says so when no channel is configured', async () => {
  const f = await mountAdmin(<ChannelList />, { '/v1/channels?limit=100': { data: [] } });
  expect(await screen.findByText(f.label('ops.channelsNone'))).toBeTruthy();
});
