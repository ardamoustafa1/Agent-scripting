import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';

import { AvayaRoutingSection } from '../avaya/avaya-routing-section.js';
import { AttachedDataSection } from '../engage/attached-data-section.js';
import { GenesysMappingSection } from '../genesys/genesys-mapping-section.js';

import { mountAdmin, syntheticId } from './fixtures.spec.helpers.js';

const campaign = {
  id: syntheticId,
  name: 'Synthetic campaign',
  version: 3,
  externalMappings: [
    { platform: 'genesys-cloud', kind: 'queue', externalId: syntheticId },
    { platform: 'avaya-aes', kind: 'vdn', externalId: '1234' },
  ],
};
const connectors = {
  data: [
    { id: syntheticId, adapterType: 'genesys_engage', status: 'active' },
    { id: 'generic', adapterType: 'generic', status: 'active' },
    { id: 'disabled', adapterType: 'genesys_engage', status: 'disabled' },
  ],
};
const mapping = {
  key: 'CustomerName',
  variable: 'name',
  type: 'string',
  writeBack: false,
  pii: true,
};
it('validates Genesys IDs, adds normalized mappings with optimistic locking and removes only the selected binding', async () => {
  const f = await mountAdmin(<GenesysMappingSection csrfToken="synthetic-csrf" />, {
    '/v1/campaigns?limit=100': { data: [campaign] },
  });
  const t = (key: string) => f.i18n.t('admin.genesysMapping.' + key);
  const input = await screen.findByLabelText(t('externalId'));
  fireEvent.change(input, { target: { value: 'invalid' } });
  fireEvent.submit(input.closest('form')!);
  await screen.findByRole('alert');
  expect(f.requests.some((request) => request.method === 'PATCH')).toBe(false);
  fireEvent.change(screen.getByLabelText(t('campaign')), { target: { value: syntheticId } });
  fireEvent.change(screen.getByLabelText(t('kind')), { target: { value: 'campaign' } });
  fireEvent.change(input, { target: { value: '01928F3A-0000-7000-8000-000000000002' } });
  fireEvent.submit(input.closest('form')!);
  await screen.findByText(t('saved'));
  const saved = f.requests.find((request) => request.method === 'PATCH');
  expect(saved?.body).toEqual({
    externalMappings: [
      ...campaign.externalMappings,
      {
        platform: 'genesys-cloud',
        kind: 'campaign',
        externalId: '01928f3a-0000-7000-8000-000000000002',
      },
    ],
  });
  expect(new Headers(saved?.init?.headers).get('if-match')).toBe('"3"');
  expect(new Headers(saved?.init?.headers).get('x-csrf-token')).toBe('synthetic-csrf');
  fireEvent.click(
    screen.getByRole('button', {
      name: f.i18n.t('admin.genesysMapping.remove', { externalId: syntheticId }),
    }),
  );
  await waitFor(() => {
    expect(f.requests.filter((request) => request.method === 'PATCH')).toHaveLength(2);
  });
  expect(f.requests.filter((request) => request.method === 'PATCH')[1]?.body).toEqual({
    externalMappings: [campaign.externalMappings[1]],
  });
});
it.each([
  ['VERBIS_RESOURCE_CONFLICT', 'conflict'],
  ['VERBIS_VALIDATION_FAILED', 'invalid'],
  ['VERBIS_HTTP_UNAVAILABLE', 'generic'],
])('reports %s after a Genesys mutation without clearing the entered ID', async (code, key) => {
  const f = await mountAdmin(<GenesysMappingSection csrfToken="synthetic-csrf" />, {
    '/v1/campaigns?limit=100': { data: [campaign] },
    ['PATCH /v1/campaigns/' + syntheticId]: Response.json({ code }, { status: 409 }),
  });
  const input = await screen.findByLabelText(f.i18n.t('admin.genesysMapping.externalId'));
  fireEvent.change(input, { target: { value: syntheticId } });
  fireEvent.submit(input.closest('form')!);
  expect((await screen.findByRole('alert')).textContent).toBe(
    f.i18n.t('admin.genesysMapping.error.' + key),
  );
  expect((input as HTMLInputElement).value).toBe(syntheticId);
});
it.each(['avaya-aes', 'avaya-aacc', 'avaya-axp'])(
  'edits %s routing with platform-appropriate kinds while preserving other mappings',
  async (platform) => {
    const f = await mountAdmin(<AvayaRoutingSection csrfToken="synthetic-csrf" />, {
      '/v1/campaigns?limit=100': { data: [campaign] },
    });
    const t = (key: string) => f.i18n.t('admin.avayaRouting.' + key);
    const input = await screen.findByLabelText(t('externalId'));
    fireEvent.change(screen.getByLabelText(t('campaign')), { target: { value: syntheticId } });
    fireEvent.change(screen.getByLabelText(t('platform')), { target: { value: platform } });
    fireEvent.change(screen.getByLabelText(t('kind')), { target: { value: 'campaign' } });
    fireEvent.change(input, { target: { value: 'invalid slash/' } });
    fireEvent.submit(input.closest('form')!);
    await screen.findByRole('alert');
    fireEvent.change(input, { target: { value: 'SyntheticCampaign' } });
    fireEvent.submit(input.closest('form')!);
    await screen.findByText(t('saved'));
    expect(f.requests.find((request) => request.method === 'PATCH')?.body).toEqual({
      externalMappings: [
        ...campaign.externalMappings,
        { platform, kind: 'campaign', externalId: 'SyntheticCampaign' },
      ],
    });
    fireEvent.click(
      screen.getByRole('button', {
        name: f.i18n.t('admin.avayaRouting.remove', { externalId: '1234' }),
      }),
    );
    await waitFor(() => {
      expect(f.requests.filter((request) => request.method === 'PATCH')).toHaveLength(2);
    });
  },
);
it.each(['VERBIS_HTTP_CONFLICT', 'VERBIS_HTTP_UNAVAILABLE'])(
  'keeps Avaya routing drafts when the server reports %s',
  async (code) => {
    const f = await mountAdmin(<AvayaRoutingSection csrfToken="synthetic-csrf" />, {
      '/v1/campaigns?limit=100': { data: [{ ...campaign, externalMappings: [] }] },
      ['PATCH /v1/campaigns/' + syntheticId]: Response.json({ code }, { status: 409 }),
    });
    const input = await screen.findByLabelText(f.i18n.t('admin.avayaRouting.externalId'));
    fireEvent.change(input, { target: { value: '1234' } });
    fireEvent.submit(input.closest('form')!);
    expect((await screen.findByRole('alert')).textContent).toBe(
      f.i18n.t(
        'admin.avayaRouting.error.' + (code === 'VERBIS_HTTP_CONFLICT' ? 'conflict' : 'generic'),
      ),
    );
  },
);
it('validates duplicate attached-data mappings, saves typed privacy/writeback flags and preserves unrelated rows', async () => {
  const next = {
    key: 'SyntheticCount',
    variable: 'count',
    type: 'number',
    writeBack: true,
    pii: true,
  };
  const map = { connectorId: syntheticId, version: 3, attachedData: [mapping] };
  const f = await mountAdmin(<AttachedDataSection csrfToken="synthetic-csrf" />, {
    '/v1/connectors?limit=100': connectors,
    [`/v1/connectors/${syntheticId}/attached-data-map`]: map,
    ['PUT /v1/connectors/' + syntheticId + '/attached-data-map']: {
      ...map,
      version: 4,
      attachedData: [mapping, next],
    },
  });
  const t = (key: string, n?: number) => f.i18n.t('admin.attachedData.' + key, { n });
  await screen.findByLabelText(t('keyFor', 1));
  fireEvent.click(screen.getByRole('button', { name: t('add') }));
  const submit = screen.getByRole('button', { name: t('save') });
  fireEvent.submit(submit.closest('form')!);
  expect((await screen.findByRole('alert')).textContent).toBe(t('error.invalid'));
  fireEvent.change(screen.getByLabelText(t('keyFor', 2)), { target: { value: 'SyntheticCount' } });
  fireEvent.change(screen.getByLabelText(t('variableFor', 2)), { target: { value: 'name' } });
  fireEvent.submit(submit.closest('form')!);
  expect((await screen.findByRole('alert')).textContent).toBe(t('error.duplicate'));
  fireEvent.change(screen.getByLabelText(t('variableFor', 2)), { target: { value: 'count' } });
  fireEvent.change(screen.getByLabelText(t('typeFor', 2)), { target: { value: 'number' } });
  fireEvent.click(screen.getByLabelText(t('writeBackFor', 2)));
  fireEvent.click(screen.getByLabelText(t('piiFor', 2)));
  fireEvent.submit(submit.closest('form')!);
  await screen.findByText(t('saved'));
  const saved = f.requests.find((request) => request.method === 'PUT');
  expect(saved?.body).toEqual({ attachedData: [mapping, next] });
  expect(new Headers(saved?.init?.headers).get('if-match')).toBe('"3"');
  fireEvent.click(screen.getAllByRole('button', { name: t('remove') })[0]!);
  await screen.findByText(t('empty'));
});
it.each(['VERBIS_CONCURRENCY_VERSION_MISMATCH', 'VERBIS_HTTP_UNAVAILABLE'])(
  'shows the proper attached-data failure for %s and retains edits',
  async (code) => {
    const f = await mountAdmin(<AttachedDataSection csrfToken="synthetic-csrf" />, {
      '/v1/connectors?limit=100': connectors,
      [`/v1/connectors/${syntheticId}/attached-data-map`]: {
        connectorId: syntheticId,
        version: 3,
        attachedData: [mapping],
      },
      ['PUT /v1/connectors/' + syntheticId + '/attached-data-map']: Response.json(
        { code },
        { status: 412 },
      ),
    });
    const input = await screen.findByLabelText(f.i18n.t('admin.attachedData.keyFor', { n: 1 }));
    fireEvent.change(input, { target: { value: 'EditedSynthetic' } });
    fireEvent.submit(input.closest('form')!);
    expect((await screen.findByRole('alert')).textContent).toBe(
      f.i18n.t(
        'admin.attachedData.error.' +
          (code === 'VERBIS_CONCURRENCY_VERSION_MISMATCH' ? 'stale' : 'generic'),
      ),
    );
  },
);
it('keeps mapping forms unavailable when no campaign or eligible Engage connector exists', async () => {
  const f = await mountAdmin(
    <>
      <GenesysMappingSection csrfToken="synthetic-csrf" />
      <AvayaRoutingSection csrfToken="synthetic-csrf" />
      <AttachedDataSection csrfToken="synthetic-csrf" />
    </>,
    { '/v1/campaigns?limit=100': { data: [] }, '/v1/connectors?limit=100': { data: [] } },
  );
  await screen.findByText(f.i18n.t('admin.genesysMapping.noCampaigns'));
  expect(screen.queryByRole('button')).toBeNull();
  expect(f.requests.some((request) => request.path.endsWith('/attached-data-map'))).toBe(false);
});
