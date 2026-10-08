import { screen } from '@testing-library/react';
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
