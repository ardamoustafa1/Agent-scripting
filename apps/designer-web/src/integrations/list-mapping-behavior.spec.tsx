import { fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { expect, it } from 'vitest';

import { createAbility } from '@verbis/authz';
import { IntegrationRecordSchema } from '@verbis/shared-types';

import { mountDesigner } from '../fixtures.spec.helpers.js';
import { scriptId, campaignId } from '../test-fixtures.js';

import { defaults } from './importers.js';
import IntegrationList from './list.js';
import { MappingEditor } from './mapping.js';

const row = IntegrationRecordSchema.parse({
  ...defaults(),
  key: 'synthetic-existing',
  definition: { ...defaults().definition, baseUrl: 'https://customer.example.io' },
  id: scriptId,
  version: 2,
});
async function allRows() {
  await screen.findByRole('table');
  const toggle = screen.queryByRole('button', { name: /show all rows/i });
  if (toggle) fireEvent.click(toggle);
}
it.each([0, 1, 2])(
  'lists integration health for breaker state %s, loads usage and paginates',
  async (breaker) => {
    const f = await mountDesigner(<IntegrationList />, {
      '/v1/data-sources?limit=50': { data: [row], page: { nextCursor: 'synthetic/cursor' } },
      '/v1/data-sources?limit=50&cursor=synthetic%2Fcursor': {
        data: [{ ...row, id: campaignId, key: 'synthetic-more' }],
        page: { nextCursor: null },
      },
      [`/v1/data-sources/${scriptId}/metrics`]: [
        {
          profile: 'dev',
          calls: 10,
          errors: breaker ? 2 : 0,
          errorRate: breaker ? 0.2 : 0,
          p50: 1,
          p95: 2,
          p99: 3,
          breaker,
        },
      ],
      [`/v1/data-sources/${scriptId}/usage`]: {
        data: [{ scriptId: campaignId, name: 'Synthetic consumer', number: 3 }],
        truncated: true,
      },
    });
    await allRows();
    expect(await screen.findByText(new RegExp(breaker ? '80.0%' : '100.0%'))).toBeTruthy();
    const summary = screen
      .getByText(f.i18n.t('designer.integrations.consumers', { count: 0 }))
      .closest('details')!;
    summary.open = true;
    fireEvent(summary, new Event('toggle'));
    expect(await screen.findByRole('link', { name: /Synthetic consumer/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: f.label('integrations.more') }));
    await waitFor(() => {
      expect(f.requests.some((r) => r.path.includes('&cursor='))).toBe(true);
    });
    await allRows();
    expect(await screen.findByRole('link', { name: 'synthetic-more' })).toBeTruthy();
  },
);
it('filters by protocol and key, shows empty results and hides forbidden creation', async () => {
  const f = await mountDesigner(
    <IntegrationList />,
    {
      '/v1/data-sources?limit=50': { data: [row], page: { nextCursor: null } },
      '/v1/data-sources?limit=50&q=absent': { data: [], page: { nextCursor: null } },
      '/v1/data-sources?limit=50&protocol=soap': { data: [], page: { nextCursor: null } },
    },
    { ability: createAbility([{ action: 'read', subject: 'Integration' }]) },
  );
  await allRows();
  expect(screen.queryByRole('link', { name: f.label('integrations.create') })).toBeNull();
  fireEvent.change(screen.getByLabelText(f.label('integrations.search')), {
    target: { value: 'absent' },
  });
  expect(await screen.findByText(f.label('integrations.empty'))).toBeTruthy();
  fireEvent.change(screen.getByLabelText(f.label('integrations.search')), {
    target: { value: '' },
  });
  fireEvent.click(screen.getByRole('combobox', { name: f.label('integrations.protocol') }));
  fireEvent.click(await screen.findByRole('option', { name: 'SOAP' }));
  expect(await screen.findByText(f.label('integrations.empty'))).toBeTruthy();
  expect(f.requests.some((r) => r.path.endsWith('protocol=soap'))).toBe(true);
});
it('retries failed integration lists', async () => {
  const f = await mountDesigner(<IntegrationList />, {
    '/v1/data-sources?limit=50': Response.json({}, { status: 500 }),
  });
  const retry = await screen.findByRole('button', { name: f.label('workspace.retry') });
  f.responses['/v1/data-sources?limit=50'] = { data: [], page: { nextCursor: null } };
  fireEvent.click(retry);
  expect(await screen.findByText(f.label('integrations.empty'))).toBeTruthy();
});
function Mapping() {
  const [value, change] = useState('');
  return (
    <MappingEditor
      sample={{ customer: { name: 'Synthetic' }, count: 12 }}
      value={value}
      onChange={change}
    />
  );
}
it('maps selected response fields, validates projection names and retains manual expressions', async () => {
  const f = await mountDesigner(<Mapping />);
  fireEvent.click(screen.getByRole('combobox', { name: f.label('integrations.sourceField') }));
  fireEvent.click(await screen.findByRole('option', { name: 'customer.name' }));
  const button = screen.getByRole('button', { name: f.label('integrations.mapField') });
  fireEvent.click(button);
  expect(screen.getByLabelText<HTMLTextAreaElement>(f.label('integrations.jsonata')).value).toBe(
    '{"result": customer.name}',
  );
  fireEvent.change(screen.getByLabelText(f.label('integrations.targetField')), {
    target: { value: 'invalid target' },
  });
  fireEvent.click(button);
  expect(await screen.findByRole('alert')).toBeTruthy();
  fireEvent.change(screen.getByLabelText(f.label('integrations.targetField')), {
    target: { value: 'synthetic' },
  });
  fireEvent.click(button);
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.change(screen.getByLabelText(f.label('integrations.jsonata')), {
    target: { value: '$.synthetic' },
  });
  expect(screen.getByLabelText<HTMLTextAreaElement>(f.label('integrations.jsonata')).value).toBe(
    '$.synthetic',
  );
});
it('explains empty mapping columns instead of rendering blank strips', async () => {
  const f = await mountDesigner(<MappingEditor sample={{}} value="" onChange={() => undefined} />);
  expect(screen.getByRole('heading', { name: f.label('integrations.sourceFields') })).toBeTruthy();
  expect(screen.getByRole('heading', { name: f.label('integrations.targetFields') })).toBeTruthy();
});
it('restores saved projections and preserves them when adding another field', async () => {
  function SavedMapping() {
    const [value, change] = useState('{"result": customer.name}');
    return (
      <MappingEditor
        sample={{ customer: { name: 'Synthetic' }, count: 12 }}
        value={value}
        onChange={change}
      />
    );
  }
  const f = await mountDesigner(<SavedMapping />);
  expect(screen.getByText('result', { selector: 'strong' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText(f.label('integrations.targetField')), {
    target: { value: 'total' },
  });
  fireEvent.click(screen.getByRole('combobox', { name: f.label('integrations.sourceField') }));
  fireEvent.click(await screen.findByRole('option', { name: 'count' }));
  fireEvent.click(screen.getByRole('button', { name: f.label('integrations.mapField') }));
  expect(screen.getByLabelText<HTMLTextAreaElement>(f.label('integrations.jsonata')).value).toBe(
    '{"result": customer.name, "total": count}',
  );
});
it('does not overwrite a manual expression with the visual mapper', async () => {
  const f = await mountDesigner(
    <MappingEditor sample={{ count: 12 }} value="$sum(count)" onChange={() => undefined} />,
  );
  fireEvent.click(screen.getByRole('combobox', { name: f.label('integrations.sourceField') }));
  fireEvent.click(await screen.findByRole('option', { name: 'count' }));
  expect(
    screen.getByRole('button', { name: f.label('integrations.mapField') }).hasAttribute('disabled'),
  ).toBe(true);
});

it('searches the entire tenant catalog on the server and starts a new cursor sequence', async () => {
  const f = await mountDesigner(<IntegrationList />, {
    '/v1/data-sources?limit=50': { data: [row], page: { nextCursor: 'old-page' } },
    '/v1/data-sources?limit=50&q=customer': {
      data: [{ ...row, key: 'customer-profile' }],
      page: { nextCursor: null },
    },
  });
  await allRows();
  fireEvent.change(screen.getByLabelText(f.label('integrations.search')), {
    target: { value: 'customer' },
  });
  await waitFor(() => {
    expect(f.requests.some((r) => r.path.endsWith('q=customer'))).toBe(true);
  });
  await allRows();
  expect(await screen.findByRole('link', { name: 'customer-profile' })).toBeTruthy();
  expect(f.requests.some((r) => r.path === '/v1/data-sources?limit=50&q=customer')).toBe(true);
  expect(screen.queryByRole('button', { name: f.label('integrations.more') })).toBeNull();
});
