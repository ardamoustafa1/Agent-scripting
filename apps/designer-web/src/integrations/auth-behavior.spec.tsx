import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { expect, it } from 'vitest';

import { createAbility } from '@verbis/authz';
import { type IntegrationAuth } from '@verbis/shared-types';

import { mountDesigner } from '../fixtures.spec.helpers.js';
import { campaignId, scriptId } from '../test-fixtures.js';

import { AuthEditor } from './auth.js';

const row = { id: campaignId, name: 'Synthetic secret', kind: 'generic', keyVersion: 2 };
const page = { data: [row], page: { nextCursor: null } };
function Harness({ initial = { type: 'none' } }: { initial?: IntegrationAuth }) {
  const [value, change] = useState(initial);
  return (
    <>
      <AuthEditor value={value} change={change} />
      <output data-testid="auth">{JSON.stringify(value)}</output>
    </>
  );
}
function auth(): unknown {
  return JSON.parse(screen.getByTestId('auth').textContent) as unknown;
}
async function choose(name: string, option: string) {
  fireEvent.click(screen.getByRole('combobox', { name }));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}
it('configures API key headers, placement and secret references without exposing secret values', async () => {
  const f = await mountDesigner(<Harness />, { '/v1/secrets?limit=100': page });
  await waitFor(() => {
    expect(f.requests).toHaveLength(1);
  });
  await choose(f.label('integrations.auth'), 'apiKey');
  await waitFor(() => {
    expect(auth()).toMatchObject({ type: 'apiKey', secretRef: campaignId });
  });
  fireEvent.change(screen.getByLabelText(f.label('integrations.headerName')), {
    target: { value: 'Synthetic-Key' },
  });
  await choose(f.label('integrations.placement'), 'query');
  expect(auth()).toEqual({
    type: 'apiKey',
    secretRef: campaignId,
    placement: 'query',
    name: 'Synthetic-Key',
  });
  expect(screen.queryByText('synthetic-plaintext')).toBeNull();
});
it.each([
  'oauth2-client-credentials',
  'oauth2-password',
  'hmac',
  'basic',
  'bearer',
  'mtls',
  'wsSecurity',
])('selects %s authentication using stored references', async (type) => {
  const f = await mountDesigner(<Harness />, { '/v1/secrets?limit=100': page });
  await waitFor(() => {
    expect(f.requests).toHaveLength(1);
  });
  await choose(f.label('integrations.auth'), type);
  await waitFor(() => {
    expect(auth()).toMatchObject({ type, secretRef: campaignId });
  });
  if (type.startsWith('oauth2')) {
    fireEvent.change(screen.getByLabelText(f.label('integrations.tokenUrl')), {
      target: { value: 'https://synthetic.example.test/token' },
    });
    fireEvent.change(screen.getByLabelText(f.label('integrations.scope')), {
      target: { value: 'synthetic:read' },
    });
    expect(auth()).toMatchObject({
      tokenUrl: 'https://synthetic.example.test/token',
      scope: 'synthetic:read',
    });
  }
  if (type === 'hmac') {
    fireEvent.change(screen.getByLabelText(f.label('integrations.headerName')), {
      target: { value: 'Synthetic-Signature' },
    });
    expect(auth()).toMatchObject({ header: 'Synthetic-Signature' });
  }
});
it('rejects authentication requiring a missing secret reference', async () => {
  const f = await mountDesigner(<Harness />, {
    '/v1/secrets?limit=100': { data: [], page: { nextCursor: null } },
  });
  await choose(f.label('integrations.auth'), 'basic');
  expect(await screen.findByText(f.label('integrations.secretError'))).toBeTruthy();
  expect(auth()).toEqual({ type: 'none' });
});
it.each([200, 500])(
  'rotates a secret with immediate password clearing and handles HTTP %s',
  async (status) => {
    const f = await mountDesigner(<Harness initial={{ type: 'basic', secretRef: campaignId }} />, {
      '/v1/secrets?limit=100': page,
      [`PUT /v1/secrets/${campaignId}`]:
        status === 200 ? { ...row, keyVersion: 3 } : Response.json({}, { status }),
    });
    const rotate = screen.getByRole('button', { name: f.label('integrations.rotate') });
    await waitFor(() => {
      expect(rotate.hasAttribute('disabled')).toBe(false);
    });
    fireEvent.click(rotate);
    const dialog = await screen.findByRole('dialog');
    const password = within(dialog).getByLabelText(f.label('integrations.secretValue'));
    fireEvent.change(password, { target: { value: 'synthetic-plaintext' } });
    fireEvent.click(within(dialog).getByRole('button', { name: f.label('integrations.save') }));
    expect((password as HTMLInputElement).value).toBe('');
    await waitFor(() => {
      expect(f.requests.some((r) => r.method === 'PUT')).toBe(true);
    });
    expect(f.requests.find((r) => r.method === 'PUT')!.body).toEqual({
      name: row.name,
      kind: 'generic',
      value: 'synthetic-plaintext',
    });
    if (status === 200)
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });
    else {
      expect(await screen.findByText(f.label('integrations.secretError'))).toBeTruthy();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });
    }
    expect(screen.queryByDisplayValue('synthetic-plaintext')).toBeNull();
  },
);
it('creates a named secret and loads additional secret choices with encoded cursors', async () => {
  const f = await mountDesigner(<Harness />, {
    '/v1/secrets?limit=100': { data: [row], page: { nextCursor: 'synthetic/cursor' } },
    '/v1/secrets?limit=100&cursor=synthetic%2Fcursor': {
      data: [{ ...row, id: scriptId, name: 'More secret' }],
      page: { nextCursor: null },
    },
    'POST /v1/secrets': { ...row, id: scriptId },
  });
  fireEvent.click(await screen.findByRole('button', { name: f.label('integrations.more') }));
  await waitFor(() => {
    expect(f.requests.some((r) => r.path.includes('&cursor='))).toBe(true);
  });
  fireEvent.click(screen.getByRole('button', { name: f.label('integrations.newSecret') }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText(f.label('integrations.name')), {
    target: { value: 'Synthetic created secret' },
  });
  fireEvent.change(within(dialog).getByLabelText(f.label('integrations.secretValue')), {
    target: { value: 'synthetic-password' },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: f.label('integrations.save') }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(f.requests.find((r) => r.method === 'POST')!.body).toEqual({
    name: 'Synthetic created secret',
    kind: 'generic',
    value: 'synthetic-password',
  });
});
it('does not fetch secrets or allow mutation when access is absent', async () => {
  const f = await mountDesigner(<Harness />, {}, { ability: createAbility([]) });
  expect(f.requests).toHaveLength(0);
  expect(
    screen
      .getByRole('button', { name: f.label('integrations.newSecret') })
      .hasAttribute('disabled'),
  ).toBe(true);
});
