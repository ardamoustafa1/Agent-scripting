import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';

import { mountAdmin } from './fixtures.spec.helpers.js';
import TrustCenterPage from './trust-page.js';

const summary = (status: 'healthy' | 'attention' | 'broken', extra = {}) => ({
  generatedAt: '2026-10-07T12:00:00.000Z',
  windowDays: 30,
  chain: {
    status,
    valid: status !== 'broken',
    checked: 1234,
    headSeq: '1234',
    breaks: status === 'broken' ? 2 : 0,
    truncated: false,
    signaturesVerified: true,
    checkpointsChecked: 4,
    latestCheckpoint: { seq: '1200', signedAt: '2026-10-07T06:00:00.000Z' },
    checkpointAgeHours: 6,
  },
  launch: { issued: 50, redeemed: 48, denied: 3, anomalies: 1, urlParamsRejected: 2 },
  sensitiveAccess: {
    auditExports: 2,
    secretMetadataViews: 7,
    secretUsageReads: 0,
    userProfileViews: 11,
    privacyExports: 1,
  },
  privacy: { open: 2, processed: 5, oldestOpenAt: '2026-09-20T09:00:00.000Z' },
  ...extra,
});

it('shows counts with a text status (never colour alone) and refetches for another period', async () => {
  const f = await mountAdmin(<TrustCenterPage />, {
    '/v1/trust-center?days=30': summary('healthy'),
    '/v1/trust-center?days=7': summary('attention', { windowDays: 7 }),
  });
  const t = (key: string) => f.i18n.t('trust.' + key);
  await screen.findByRole('heading', { name: t('title') });
  expect((await screen.findByRole('status')).textContent).toContain(
    `${t('chainStatus')}: ${t('status.healthy')}`,
  );
  expect(screen.getByText(t('statusHint.healthy'))).toBeDefined();
  expect(screen.getByText('1,234')).toBeDefined();
  fireEvent.change(screen.getByRole('combobox', { name: t('window') }), {
    target: { value: '7' },
  });
  await waitFor(() => {
    expect(f.requests.some((r) => r.path === '/v1/trust-center?days=7')).toBe(true);
  });
  expect(await screen.findByText(t('statusHint.attention'))).toBeDefined();
});

it('flags a broken chain as broken and states that attention is not proof of integrity', async () => {
  const f = await mountAdmin(<TrustCenterPage />, {
    '/v1/trust-center?days=30': summary('broken'),
  });
  const t = (key: string) => f.i18n.t('trust.' + key);
  expect(await screen.findByText(t('statusHint.broken'))).toBeDefined();
  expect(screen.getByRole('status').textContent).toContain(t('status.broken'));
  expect(f.i18n.t('trust.statusHint.attention')).toMatch(/not|değil|saymay/i);
});

it('shows a recoverable error instead of stale or invented numbers', async () => {
  const f = await mountAdmin(<TrustCenterPage />, {
    '/v1/trust-center?days=30': new Response(JSON.stringify({ code: 'VERBIS_FORBIDDEN' }), {
      status: 403,
      headers: { 'content-type': 'application/problem+json' },
    }),
  });
  expect(await screen.findByText(f.i18n.t('trust.error'))).toBeDefined();
  expect(screen.queryByText('1,234')).toBeNull();
});
