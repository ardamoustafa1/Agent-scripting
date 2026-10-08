import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { CheckpointsSection } from './checkpoints-section.js';
import { mountAdmin } from './fixtures.spec.helpers.js';

const checkpoint = (n: number, signedAt: string) => ({
  id: `cp-${String(n)}`,
  seq: String(n * 100),
  hash: 'a'.repeat(64),
  sessionHeadsDigest: 'b'.repeat(64),
  sessionHeadsCount: 7,
  prevCheckpointId: null,
  keyId: 'audit-key-1',
  signature: 'sig',
  signedAt,
});
const NOW = new Date('2026-10-08T12:00:00Z');
const keys = { keys: [{ kty: 'OKP', crv: 'Ed25519', kid: 'audit-key-1', x: 'abc' }] };
const showRows = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /show all rows/i }));
};

it('lists the signed checkpoints and the public verification keys', async () => {
  const f = await mountAdmin(<CheckpointsSection now={NOW} />, {
    '/v1/audit-checkpoints': [
      checkpoint(2, '2026-10-08T06:00:00Z'),
      checkpoint(1, '2026-10-08T00:00:00Z'),
    ],
    '/v1/audit-checkpoints/keys': keys,
  });
  await showRows();
  const t = (key: string) => f.i18n.t('trust.checkpoints.' + key);
  expect(await screen.findByText('200')).toBeTruthy();
  expect(screen.getAllByText(`${'a'.repeat(16)}…`)).toHaveLength(2);
  expect(screen.getByText('audit-key-1', { selector: 'code' })).toBeTruthy();
  expect(screen.getByText(t('keysHint'))).toBeTruthy();
  expect(screen.queryByText(t('stale').slice(0, 10))).toBeNull();
});

it('warns when the newest checkpoint is more than a day old', async () => {
  const f = await mountAdmin(<CheckpointsSection now={NOW} />, {
    '/v1/audit-checkpoints': [checkpoint(1, '2026-10-06T00:00:00Z')],
    '/v1/audit-checkpoints/keys': keys,
  });
  expect(await screen.findByText(/older than 24 hours/)).toBeTruthy();
  expect(f.requests.length).toBeGreaterThan(0);
});

it('says so when there are no checkpoints yet, and when no signing key exists', async () => {
  const f = await mountAdmin(<CheckpointsSection now={NOW} />, {
    '/v1/audit-checkpoints': [],
    '/v1/audit-checkpoints/keys': { keys: [] },
  });
  expect(await screen.findByText(f.i18n.t('trust.checkpoints.none'))).toBeTruthy();
  expect(await screen.findByText(f.i18n.t('trust.checkpoints.noKeys'))).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: f.i18n.t('trust.checkpoints.downloadKeys') }),
  ).toBeNull();
});

it('downloads the public keys', async () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  vi.stubGlobal(
    'URL',
    Object.assign(URL, {
      createObjectURL: vi.fn().mockReturnValue('blob:k'),
      revokeObjectURL: vi.fn(),
    }),
  );
  const f = await mountAdmin(<CheckpointsSection now={NOW} />, {
    '/v1/audit-checkpoints': [checkpoint(1, '2026-10-08T06:00:00Z')],
    '/v1/audit-checkpoints/keys': keys,
  });
  fireEvent.click(
    await screen.findByRole('button', { name: f.i18n.t('trust.checkpoints.downloadKeys') }),
  );
  await waitFor(() => {
    expect(click).toHaveBeenCalled();
  });
});

it('shows an error instead of an empty list when loading fails', async () => {
  const f = await mountAdmin(<CheckpointsSection now={NOW} />, {
    '/v1/audit-checkpoints': Response.json({}, { status: 500 }),
    '/v1/audit-checkpoints/keys': keys,
  });
  expect(await screen.findByText(f.i18n.t('trust.checkpoints.error'))).toBeTruthy();
  expect(screen.queryByText(f.i18n.t('trust.checkpoints.none'))).toBeNull();
});
