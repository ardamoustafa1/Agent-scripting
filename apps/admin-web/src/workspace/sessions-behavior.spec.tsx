import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';

import { mountAdmin } from './fixtures.spec.helpers.js';
import MySessions, { describeAgent } from './sessions-page.js';

const session = (id: string, extra: object = {}) => ({
  id,
  kind: 'sso',
  protocol: 'oidc',
  idpId: null,
  app: 'designer',
  createdAt: '2026-10-08T08:00:00Z',
  lastSeenAt: '2026-10-08T09:00:00Z',
  expiresAt: '2026-10-08T18:00:00Z',
  ip: '10.0.0.5',
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
  current: false,
  ...extra,
});
const a = '01928f3a-0000-7000-8000-00000000000a',
  b = '01928f3a-0000-7000-8000-00000000000b',
  c = '01928f3a-0000-7000-8000-00000000000c';

it('describes common browsers and systems, and shortens unknown agents', () => {
  expect(describeAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/140 Edg/140')).toEqual({
    browser: 'Edge',
    system: 'Windows',
  });
  expect(describeAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18) Safari/605')).toEqual({
    browser: 'Safari',
    system: 'iOS',
  });
  expect(describeAgent('Mozilla/5.0 (X11; Linux x86_64; rv:140) Firefox/140')).toEqual({
    browser: 'Firefox',
    system: 'Linux',
  });
  expect(describeAgent('curl/8.0.1').browser).toBe('curl/8.0.1');
  expect(describeAgent('x'.repeat(200)).browser).toHaveLength(40);
  expect(describeAgent('')).toEqual({ browser: '', system: '' });
});

it('shows each session in readable terms and marks the current one without an end button', async () => {
  const f = await mountAdmin(<MySessions />, {
    '/v1/me/sessions': {
      data: [
        session(a, { current: true }),
        session(b, { app: 'agent', kind: 'break_glass', protocol: 'local' }),
      ],
    },
  });
  const t = (key: string) => f.label('account.' + key);
  expect(await screen.findByText(t('thisDevice'))).toBeTruthy();
  expect(screen.getAllByText('Chrome · macOS')).toHaveLength(2);
  expect(screen.getByText(t('breakGlass'))).toBeTruthy();
  expect(screen.getByText(t('app.agent'))).toBeTruthy();
  // The current session explains how to leave instead of offering to end itself.
  expect(screen.getAllByRole('button', { name: t('end') })).toHaveLength(1);
  expect(screen.getByText(t('currentHint'))).toBeTruthy();
  // No raw enum values.
  expect(screen.queryByText('oidc')).toBeNull();
  expect(screen.queryByText('break_glass')).toBeNull();
});

it('ends one session only after confirmation', async () => {
  const f = await mountAdmin(<MySessions />, {
    '/v1/me/sessions': { data: [session(a, { current: true }), session(b)] },
    [`DELETE /v1/me/sessions/${b}`]: new Response(null, { status: 204 }),
  });
  fireEvent.click(await screen.findByRole('button', { name: f.label('account.end') }));
  expect(f.requests.some((r) => r.method === 'DELETE')).toBe(false);
  fireEvent.click(await screen.findByRole('button', { name: f.label('confirm') }));
  await waitFor(() => {
    expect(f.requests.some((r) => r.method === 'DELETE' && r.path === `/v1/me/sessions/${b}`)).toBe(
      true,
    );
  });
});

it('ends all other sessions with a count, behind a confirmation, and refreshes the list', async () => {
  const f = await mountAdmin(<MySessions />, {
    '/v1/me/sessions': { data: [session(a, { current: true }), session(b), session(c)] },
    'DELETE /v1/me/sessions': { terminated: 2 },
  });
  const label = f.i18n.t('adminWorkspace.account.endAll', { count: 2 });
  const group = (await screen.findByRole('button', { name: label })).closest('.aw-action')!;
  fireEvent.click(within(group as HTMLElement).getByRole('button', { name: label }));
  expect(f.requests.some((r) => r.method === 'DELETE')).toBe(false);
  fireEvent.click(
    await within(group as HTMLElement).findByRole('button', { name: f.label('confirm') }),
  );
  await waitFor(() => {
    expect(f.requests.some((r) => r.method === 'DELETE' && r.path === '/v1/me/sessions')).toBe(
      true,
    );
  });
});

it('offers no bulk action when this is the only session', async () => {
  const f = await mountAdmin(<MySessions />, {
    '/v1/me/sessions': { data: [session(a, { current: true })] },
  });
  await screen.findByText(f.label('account.thisDevice'));
  expect(screen.queryByText(f.label('account.endAllTitle'))).toBeNull();
});
