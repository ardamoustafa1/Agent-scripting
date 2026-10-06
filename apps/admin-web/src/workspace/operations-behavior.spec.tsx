import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';

import { createAbility } from '@verbis/authz';

import { mountAdmin, syntheticId } from './fixtures.spec.helpers.js';
import { Audit, Connectors, Health, Secrets } from './operations-pages.js';

async function rows(title: string) {
  const table = await screen.findByRole('table', { name: title });
  const parent = table.closest<HTMLElement>('.aw-card')!;
  const all = within(parent).queryByRole('button', { name: /show all rows/i });
  if (all) fireEvent.click(all);
  return within(parent);
}
function change(f: Awaited<ReturnType<typeof mountAdmin>>, key: string, value: string, index = 0) {
  fireEvent.change(screen.getAllByLabelText(f.label(key))[index]!, { target: { value } });
}
function form(key: string) {
  return screen.getByLabelText(key).closest('form')!;
}
it('creates and edits versioned connector configurations, probes connectivity and opens audit diagnostics', async () => {
  const row = {
    id: syntheticId,
    version: 4,
    platform: 'synthetic',
    adapterType: 'generic',
    status: 'draft',
    config: { synthetic: true },
    secretRefs: ['synthetic-secret'],
    health: { status: 'unknown' },
  };
  const f = await mountAdmin(<Connectors />, {
    '/v1/connectors': [row],
    [`/v1/admin/connectors/${syntheticId}`]: row,
    [`/v1/admin/connectors/${syntheticId}/test`]: { status: 'ok' },
  });
  change(f, 'adapterType', 'amazon_connect');
  change(f, 'platform', 'synthetic-created');
  change(f, 'configuration', '{"synthetic":true}');
  change(f, 'secretRefs', 'synthetic-secret,other-secret');
  fireEvent.submit(form(f.label('adapterType')));
  await waitFor(() => {
    expect(f.requests.some((request) => request.method === 'POST')).toBe(true);
  });
  expect(f.requests.find((request) => request.method === 'POST')?.body).toMatchObject({
    adapterType: 'amazon_connect',
    config: { synthetic: true },
    secretRefs: ['synthetic-secret', 'other-secret'],
  });
  fireEvent.click(
    (await rows(f.label('connectors'))).getByRole('button', { name: f.label('details') }),
  );
  await screen.findByRole('button', { name: f.label('probe') });
  change(f, 'status', 'active');
  fireEvent.submit(form(f.label('adapterType')));
  await waitFor(() => {
    expect(f.requests.some((request) => request.method === 'PUT')).toBe(true);
  });
  expect(f.requests.find((request) => request.method === 'PUT')?.init?.headers).toMatchObject({
    'if-match': '"4"',
  });
  fireEvent.click(screen.getByRole('button', { name: f.label('probe') }));
  await waitFor(() => {
    expect(f.requests.some((request) => request.path.endsWith('/test'))).toBe(true);
  });
  fireEvent.click(screen.getByRole('button', { name: f.label('liveEvents') }));
  await screen.findByRole('table', { name: f.label('liveEvents') });
  fireEvent.click(screen.getByRole('button', { name: f.label('liveEvents') }));
  expect(screen.queryByRole('table', { name: f.label('liveEvents') })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: f.label('create') }));
  expect(screen.queryByRole('button', { name: f.label('probe') })).toBeNull();
});
it('maps platform users and campaign queues while preserving unrelated mappings and de-duplicating the chosen queue', async () => {
  const mapping = { platform: 'amazon-connect', kind: 'queue', externalId: 'synthetic-queue' };
  const f = await mountAdmin(<Connectors />, {
    '/v1/users': [{ id: syntheticId, displayName: 'Synthetic user' }],
    '/v1/campaigns': [{ id: syntheticId, name: 'Synthetic campaign' }],
    [`/v1/campaigns/${syntheticId}`]: {
      id: syntheticId,
      version: 3,
      externalMappings: [mapping, { platform: 'cisco', kind: 'queue', externalId: 'other-queue' }],
    },
  });
  await screen.findByRole('option', { name: 'Synthetic user' });
  change(f, 'user', syntheticId);
  change(f, 'platform', 'synthetic-platform', 1);
  change(f, 'platformUserId', 'synthetic-agent');
  fireEvent.submit(form(f.label('platformUserId')));
  await waitFor(() => {
    expect(f.requests.some((request) => request.path.endsWith('/connector-mapping'))).toBe(true);
  });
  expect(f.requests.find((request) => request.path.endsWith('/connector-mapping'))?.body).toEqual({
    platform: 'synthetic-platform',
    platformUserId: 'synthetic-agent',
  });
  change(f, 'campaign', syntheticId);
  await screen.findByText('amazon-connect · queue · synthetic-queue');
  change(f, 'externalId', 'synthetic-queue');
  fireEvent.submit(form(f.label('externalId')));
  await waitFor(() => {
    expect(f.requests.some((request) => request.method === 'PATCH')).toBe(true);
  });
  expect(f.requests.find((request) => request.method === 'PATCH')?.body).toEqual({
    externalMappings: [{ platform: 'cisco', kind: 'queue', externalId: 'other-queue' }, mapping],
  });
  fireEvent.click(screen.getAllByRole('button', { name: f.label('remove') })[0]!);
  fireEvent.click(screen.getByRole('button', { name: f.label('confirm') }));
  await waitFor(() => {
    expect(f.requests.filter((request) => request.method === 'PATCH')).toHaveLength(2);
  });
});
it('hides connector write and diagnostic capabilities when permissions deny them', async () => {
  const f = await mountAdmin(
    <Connectors />,
    {},
    createAbility([{ action: 'read', subject: 'Connector' }]),
  );
  expect(
    within(form(f.label('adapterType')))
      .getByRole('button', { name: f.label('save') })
      .getAttribute('disabled'),
  ).not.toBeNull();
  expect(screen.queryByLabelText(f.label('platformUserId'))).toBeNull();
  expect(screen.queryByLabelText(f.label('campaign'))).toBeNull();
});
it('creates and rotates secrets without redisplaying the value and shows authorized usage metadata', async () => {
  const f = await mountAdmin(<Secrets />, {
    '/v1/secrets': [{ id: syntheticId, name: 'Synthetic key', kind: 'api_key', version: 5 }],
    [`/v1/admin/secrets/${syntheticId}/usage`]: {
      data: [{ id: 'first', key: 'synthetic-endpoint' }, { id: 'fallback' }],
      truncated: false,
    },
  });
  change(f, 'name', 'Synthetic key');
  change(f, 'kind', 'password');
  change(f, 'replaceSecret', 'synthetic-ephemeral-secret');
  fireEvent.submit(form(f.label('replaceSecret')));
  await waitFor(() => {
    expect(screen.getByLabelText<HTMLInputElement>(f.label('replaceSecret')).value).toBe('');
  });
  expect(f.requests.find((request) => request.method === 'POST')?.body).toEqual({
    name: 'Synthetic key',
    kind: 'password',
    value: 'synthetic-ephemeral-secret',
  });
  fireEvent.click(
    (await rows(f.label('secrets'))).getByRole('button', { name: f.label('details') }),
  );
  await screen.findByText('synthetic-endpoint');
  expect(screen.getByText('fallback')).toBeDefined();
  change(f, 'replaceSecret', 'synthetic-rotated');
  fireEvent.submit(form(f.label('replaceSecret')));
  await waitFor(() => {
    expect(f.requests.some((request) => request.method === 'PUT')).toBe(true);
  });
  expect(f.requests.find((request) => request.method === 'PUT')?.init?.headers).toMatchObject({
    'if-match': '"5"',
  });
});
it('clears secret values after rejected rotation and denies usage metadata to unauthorized operators', async () => {
  const f = await mountAdmin(
    <Secrets />,
    {
      '/v1/secrets': [{ id: syntheticId, name: 'Synthetic key', kind: 'api_key' }],
      ['PUT /v1/secrets/' + syntheticId]: Response.json(
        { code: 'VERBIS_FORBIDDEN' },
        { status: 403 },
      ),
    },
    createAbility([{ action: 'manage', subject: 'Secret' }]),
  );
  fireEvent.click(
    (await rows(f.label('secrets'))).getByRole('button', { name: f.label('details') }),
  );
  await screen.findByText(f.label('denied'));
  change(f, 'replaceSecret', 'synthetic-rejected');
  fireEvent.submit(form(f.label('replaceSecret')));
  await screen.findByRole('alert');
  expect(screen.getByLabelText<HTMLInputElement>(f.label('replaceSecret')).value).toBe('');
  expect(f.requests.some((request) => request.path.endsWith('/usage'))).toBe(false);
});
it.each([
  { valid: true, truncated: false },
  { valid: false, truncated: false },
  { valid: false, truncated: true },
])('verifies audit-chain ranges and reports the actual %j result', async (report) => {
  const f = await mountAdmin(<Audit />, { '/v1/audit-events/verify': report });
  change(f, 'fromSeq', '10');
  change(f, 'toSeq', '20');
  fireEvent.click(screen.getByRole('button', { name: f.label('verify') }));
  await screen.findByText(
    f.label(report.truncated ? 'truncated' : report.valid ? 'validChain' : 'brokenChain'),
  );
  expect(f.requests.find((request) => request.path.endsWith('/verify'))?.body).toEqual({
    fromSeq: '10',
    toSeq: '20',
  });
});
it('filters audit rows, renders event diffs and follows a correlation without exporting unrelated content', async () => {
  const f = await mountAdmin(<Audit />, {
    '/v1/audit-events?': [
      {
        id: syntheticId,
        action: 'synthetic.created',
        correlationId: 'synthetic-correlation',
        diff: { mode: 'snapshot', before: {}, after: { synthetic: true } },
      },
    ],
  });
  fireEvent.click((await rows(f.label('audit'))).getByRole('button', { name: f.label('details') }));
  expect(await screen.findByText(f.label('eventDetails'))).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: f.label('related') }));
  await waitFor(() => {
    expect(
      f.requests.some(
        (request) => request.path === '/v1/audit-events?correlationId=synthetic-correlation',
      ),
    ).toBe(true);
  });
  change(f, 'q', 'synthetic query');
  change(f, 'from', '2026-10-03T10:00');
  change(f, 'to', '2026-10-03T12:00');
  fireEvent.submit(form(f.label('q')));
  await waitFor(() => {
    expect(
      f.requests.some(
        (request) => request.path.includes('q=synthetic+query') && request.path.includes('from='),
      ),
    ).toBe(true);
  });
});
it.each(['webhook', 'syslog', 'kafka'])(
  'creates %s SIEM destinations with the correct transport configuration',
  async (kind) => {
    const f = await mountAdmin(<Audit />);
    change(f, 'name', 'Synthetic SIEM');
    change(f, 'kind', kind);
    change(
      f,
      kind === 'syslog' ? 'host' : kind === 'webhook' ? 'url' : 'topic',
      kind === 'webhook' ? 'https://siem.example.test' : 'synthetic-endpoint',
    );
    if (kind === 'webhook') change(f, 'secretName', 'synthetic-secret');
    if (kind === 'syslog') change(f, 'port', '6515');
    fireEvent.submit(form(f.label('name')));
    await waitFor(() => {
      expect(
        f.requests.some(
          (request) => request.path === '/v1/siem-destinations' && request.method === 'POST',
        ),
      ).toBe(true);
    });
    const saved = f.requests.find(
      (request) => request.path === '/v1/siem-destinations' && request.method === 'POST',
    );
    expect(saved?.body).toMatchObject({
      name: 'Synthetic SIEM',
      kind,
      format: kind === 'syslog' ? 'rfc5424' : 'json',
      config:
        kind === 'syslog'
          ? { host: 'synthetic-endpoint', port: 6515 }
          : kind === 'webhook'
            ? { url: 'https://siem.example.test' }
            : { topic: 'synthetic-endpoint' },
    });
    if (kind === 'webhook')
      expect(saved?.body).toHaveProperty('secretRef', 'secret://synthetic-secret');
  },
);
it('toggles versioned SIEM delivery and requires confirmation before removing a destination', async () => {
  const f = await mountAdmin(<Audit />, {
    '/v1/siem-destinations': [
      {
        id: syntheticId,
        name: 'Synthetic SIEM',
        kind: 'webhook',
        enabled: true,
        version: 3,
        delivery: { status: 'ok' },
      },
    ],
    ['PATCH /v1/siem-destinations/' + syntheticId]: { id: syntheticId, enabled: false, version: 4 },
  });
  fireEvent.click((await rows(f.label('siem'))).getByRole('button', { name: f.label('details') }));
  fireEvent.click(screen.getByRole('button', { name: f.label('toggleEnabled') }));
  await waitFor(() => {
    expect(f.requests.some((request) => request.method === 'PATCH')).toBe(true);
  });
  expect(f.requests.find((request) => request.method === 'PATCH')).toMatchObject({
    body: { enabled: false },
  });
  fireEvent.click(screen.getByRole('button', { name: f.label('remove') }));
  fireEvent.click(screen.getByRole('button', { name: f.label('confirm') }));
  await waitFor(() => {
    expect(f.requests.some((request) => request.method === 'DELETE')).toBe(true);
  });
});
it.each([null, 0.125])(
  'shows readiness and sampled operational error rates and confirms dead-event requeue',
  async (errorRate) => {
    const f = await mountAdmin(<Health />, {
      '/health/ready': Response.json(
        { status: 'error', checks: { database: { status: 'down' } } },
        { status: 503 },
      ),
      '/v1/admin/operations': { windowHours: 24, total: 8, failed: 1, errorRate },
      '/v1/admin/outbox': {
        pending: 1,
        published: 2,
        dead: 1,
        oldestPendingAt: null,
        deadEvents: [
          {
            id: 'synthetic-dead',
            eventType: 'synthetic.event',
            attempts: 3,
            lastError: 'Synthetic unavailable',
          },
        ],
      },
    });
    await screen.findByText('synthetic.event');
    expect(
      screen.getByRole<HTMLTextAreaElement>('textbox', { name: f.label('details') }).value,
    ).toContain('database');
    if (errorRate === null)
      expect(screen.getByText(new RegExp(f.label('noSamples')))).toBeDefined();
    else expect(screen.getByText(/12.5%/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: f.label('requeue') }));
    expect(f.requests.some((request) => request.path.endsWith('/requeue'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: f.label('confirm') }));
    await waitFor(() => {
      expect(f.requests.some((request) => request.path.endsWith('/requeue'))).toBe(true);
    });
  },
);

it('requires a fresh deletion confirmation after switching SIEM destinations', async () => {
  const secondId = '01928f3a-0000-7000-8000-000000000002';
  const f = await mountAdmin(<Audit />, {
    '/v1/siem-destinations': [
      { id: syntheticId, name: 'First destination', kind: 'webhook', version: 1 },
      { id: secondId, name: 'Second destination', kind: 'webhook', version: 1 },
    ],
  });
  const list = await rows(f.label('siem'));
  fireEvent.click(list.getAllByRole('button', { name: f.label('details') })[0]!);
  fireEvent.click(screen.getByRole('button', { name: f.label('remove') }));
  expect(screen.getByRole('button', { name: f.label('confirm') })).toBeDefined();
  fireEvent.click(list.getAllByRole('button', { name: f.label('details') })[1]!);
  expect(screen.queryByRole('button', { name: f.label('confirm') })).toBeNull();
  expect(f.requests.some((request) => request.method === 'DELETE')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: f.label('remove') }));
  fireEvent.click(screen.getByRole('button', { name: f.label('confirm') }));
  await waitFor(() => {
    expect(f.requests.some((request) => request.method === 'DELETE')).toBe(true);
  });
  expect(f.requests.find((request) => request.method === 'DELETE')?.path).toBe(
    `/v1/siem-destinations/${secondId}`,
  );
});

it('disables secret creation and rotation for metadata-only readers', async () => {
  const f = await mountAdmin(
    <Secrets />,
    {
      '/v1/secrets': [{ id: syntheticId, name: 'Synthetic metadata', kind: 'api_key', version: 1 }],
    },
    createAbility([{ action: 'read', subject: 'Secret' }]),
  );
  expect(screen.getByRole('button', { name: f.label('create') }).hasAttribute('disabled')).toBe(
    true,
  );
  expect(screen.getByRole('button', { name: f.label('save') }).hasAttribute('disabled')).toBe(true);
  fireEvent.submit(form(f.label('replaceSecret')));
  fireEvent.click(
    (await rows(f.label('secrets'))).getByRole('button', { name: f.label('details') }),
  );
  await screen.findByRole('heading', { name: f.label('rotate') });
  expect(screen.getByRole('button', { name: f.label('save') }).hasAttribute('disabled')).toBe(true);
  fireEvent.submit(form(f.label('replaceSecret')));
  expect(f.requests.filter((request) => request.method !== 'GET')).toEqual([]);
});
