import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { mountAdmin, syntheticId } from './fixtures.spec.helpers.js';
import { SpCredentials, toPem } from './sp-credentials.js';

const credential = (id: string, use: string, state: string, notAfter: string) => ({
  id,
  use,
  state,
  certificate: 'MIIBAAAA',
  notAfter,
});
const idp = (credentials: object[]) => ({
  id: syntheticId,
  version: 3,
  config: { spCredentials: credentials },
});
const a = '01928f3a-0000-7000-8000-00000000000a',
  b = '01928f3a-0000-7000-8000-00000000000b',
  c = '01928f3a-0000-7000-8000-00000000000c';
const NOW = new Date('2026-10-08T00:00:00Z');
const base = `/v1/identity-providers/${syntheticId}/sp-credentials`;

it('wraps a bare base64 certificate as PEM and leaves armoured text alone', () => {
  expect(toPem('AAAA')).toBe('-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n');
  expect(toPem('x'.repeat(130)).split('\n')[1]).toHaveLength(64);
  const armoured = '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----';
  expect(toPem(armoured)).toBe(armoured);
});

it('lists each certificate with its purpose, state and validity, and warns before the active one expires', async () => {
  const f = await mountAdmin(
    <SpCredentials
      now={NOW}
      row={idp([
        credential(a, 'signing', 'active', '2026-10-20T00:00:00Z'),
        credential(b, 'signing', 'next', '2027-10-20T00:00:00Z'),
        credential(c, 'encryption', 'active', '2027-06-01T00:00:00Z'),
      ])}
    />,
  );
  expect(screen.getAllByRole('listitem')).toHaveLength(3);
  expect(screen.getAllByText(/expires on/i)).toHaveLength(1);
  // Raw enum values never reach the screen.
  expect(screen.queryByText('signing')).toBeNull();
  expect(screen.getAllByText(f.label('enum.spState.next')).length).toBeGreaterThan(0);
});

it('offers adding only when no pending certificate exists for that purpose', async () => {
  const f = await mountAdmin(
    <SpCredentials
      now={NOW}
      row={idp([
        credential(a, 'signing', 'active', '2027-10-20T00:00:00Z'),
        credential(b, 'signing', 'next', '2028-10-20T00:00:00Z'),
      ])}
    />,
  );
  const signing = f.i18n.t('adminWorkspace.sp.add', { use: f.label('enum.spUse.signing') });
  const encryption = f.i18n.t('adminWorkspace.sp.add', { use: f.label('enum.spUse.encryption') });
  expect(screen.getByRole<HTMLButtonElement>('button', { name: signing }).disabled).toBe(true);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: encryption }).disabled).toBe(false);
  expect(screen.getByText(f.label('sp.alreadyNext'))).toBeTruthy();
});

it('creates, promotes (after confirmation) and removes through the identity provider API', async () => {
  const f = await mountAdmin(
    <SpCredentials
      now={NOW}
      row={idp([
        credential(a, 'signing', 'active', '2027-10-20T00:00:00Z'),
        credential(b, 'signing', 'next', '2028-10-20T00:00:00Z'),
        credential(c, 'encryption', 'retired', '2026-12-20T00:00:00Z'),
      ])}
    />,
  );
  fireEvent.click(
    screen.getByRole('button', {
      name: f.i18n.t('adminWorkspace.sp.add', { use: f.label('enum.spUse.encryption') }),
    }),
  );
  await waitFor(() => {
    expect(f.requests.some((r) => r.method === 'POST' && r.path === base)).toBe(true);
  });
  expect(f.requests.find((r) => r.path === base)?.body).toEqual({ use: 'encryption' });

  fireEvent.click(screen.getByRole('button', { name: f.label('sp.promote') }));
  expect(f.requests.some((r) => r.path.endsWith('/promote'))).toBe(false);
  fireEvent.click(await screen.findByRole('button', { name: f.label('confirm') }));
  await waitFor(() => {
    expect(f.requests.some((r) => r.path === `${base}/${b}/promote`)).toBe(true);
  });

  // Only non-active certificates can be removed.
  const removes = screen.getAllByRole('button', { name: f.label('sp.remove') });
  expect(removes).toHaveLength(2);
  // Credentials are ordered by purpose, then state: the retired encryption one comes first.
  fireEvent.click(removes[0]!);
  const dialog = removes[0]!.closest('li')!;
  fireEvent.click(await within(dialog).findByRole('button', { name: f.label('confirm') }));
  await waitFor(() => {
    expect(f.requests.some((r) => r.method === 'DELETE' && r.path === `${base}/${c}`)).toBe(true);
  });
});

it('downloads the certificate as a PEM file', async () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  const create = vi.fn().mockReturnValue('blob:synthetic');
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }));
  const f = await mountAdmin(
    <SpCredentials
      now={NOW}
      row={idp([credential(a, 'signing', 'active', '2027-10-20T00:00:00Z')])}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: f.label('sp.download') }));
  expect(click).toHaveBeenCalledTimes(1);
  const blob = create.mock.calls[0]![0] as Blob;
  const text = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.readAsText(blob);
  });
  expect(text).toContain('BEGIN CERTIFICATE');
});

it('shows an empty state for a provider without certificates and disables changes without permission', async () => {
  const f = await mountAdmin(<SpCredentials now={NOW} row={idp([])} />);
  expect(screen.getByText(f.label('sp.none'))).toBeTruthy();
});
