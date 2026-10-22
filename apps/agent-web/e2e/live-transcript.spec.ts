import { AxeBuilder } from '@axe-core/playwright';

import { minimalScript } from '@verbis/script-schema/fixtures';

import { expect, test, type Page } from '../../../tests/playwright/test.js';

// ADR-0052: live transcript tab and trigger prompt cards on the agent desktop.
test.use({ locale: 'en-US' });
const id = '01928f3a-0000-7000-8000-000000000001';

async function desktop(page: Page) {
  const document = minimalScript();
  document.pages.push({
    id: 'retention',
    name: 'Retention offer',
    layout: { id: 'retention-root', type: 'box' },
  });
  document.flow.nodes.push({ id: 'n-retention', type: 'page', page: 'retention' });
  document.i18n.messages['en'] = {
    ...document.i18n.messages['en'],
    'hint.cancel': 'Offer the loyalty discount first.',
  };
  document.i18n.messages['tr'] = {
    ...document.i18n.messages['tr'],
    'hint.cancel': 'Önce sadakat indirimini önerin.',
  };
  const view = {
    id,
    state: 'active',
    sequence: 1,
    readOnly: true,
    snapshot: { variables: {}, currentPage: 'home', history: [], timers: {} },
  };
  const data = {
    document,
    view,
    checksum: 'synthetic',
    startedAt: '2026-10-22T09:00:00Z',
    interaction: {
      channel: 'voice',
      status: 'connected',
      queue: 'Synthetic queue',
      platform: 'generic',
      customerName: 'Synthetic customer',
      context: {},
    },
    campaign: { name: 'Synthetic campaign', outcomes: [] },
    writeback: 'none',
    transcript: { enabled: true },
    prompts: [
      {
        triggerId: 'cancel-intent',
        segmentId: 's2',
        speaker: 'customer',
        firedAt: '2026-10-22T09:00:05Z',
        actions: [
          { type: 'suggestPage', pageId: 'retention' },
          { type: 'alert', messageKey: 'hint.cancel', tone: 'warning' },
        ],
      },
    ],
  };
  const resolved: unknown[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.includes('/desktop/prompts/')) {
      resolved.push(route.request().postDataJSON());
      data.prompts = [];
    }
    const result =
      path === '/api/auth/session'
        ? {
            user: { id: 'synthetic-user', tenantId: 'synthetic-tenant', authMethod: 'sso' },
            session: { id: 'synthetic-bff' },
            csrfToken: 'synthetic-csrf',
          }
        : path.endsWith('/permissions')
          ? { roles: ['agent'] }
          : path === '/api/v1/sessions'
            ? { data: [], page: { nextCursor: null } }
            : path.endsWith('/desktop')
              ? data
              : path.endsWith('/desktop/transcript')
                ? {
                    enabled: true,
                    lines: [
                      {
                        segmentId: 's1',
                        speaker: 'agent',
                        text: 'Good morning, how can I help?',
                        final: true,
                        at: '2026-10-22T09:00:01Z',
                      },
                    ],
                  }
                : path.endsWith('/attach')
                  ? {
                      ...view,
                      readOnly: false,
                      writeToken: 'a'.repeat(43),
                      leaseUntil: '2099-10-03T10:00:00Z',
                    }
                  : path.endsWith('/state') ||
                      path.includes('/desktop/prompts/') ||
                      path.endsWith('/commands')
                    ? view
                    : path.endsWith('/socket-ticket')
                      ? { ticket: 'synthetic', namespace: '/launch' }
                      : null;
    await route.fulfill({
      status: result ? 200 : 404,
      contentType: 'application/json',
      body: JSON.stringify(result ?? {}),
    });
  });
  await page.routeWebSocket('**/socket.io/**', (socket) => {
    socket.send(
      '0' +
        JSON.stringify({
          sid: 'synthetic',
          upgrades: [],
          pingInterval: 60000,
          pingTimeout: 60000,
          maxPayload: 1000000,
        }),
    );
    socket.onMessage((message) => {
      if (typeof message !== 'string') return;
      if (message.startsWith('40/launch')) socket.send('40/launch,{"sid":"synthetic-launch"}');
      if (message.startsWith('40/runtime')) {
        socket.send('40/runtime,{"sid":"synthetic-runtime"}');
        socket.send('42/runtime,["runtime.resume",{}]');
        socket.send(
          `42/runtime,${JSON.stringify([
            'runtime.transcript',
            {
              segmentId: 's2',
              speaker: 'customer',
              text: 'I want to cancel my subscription',
              final: true,
              at: '2026-10-22T09:00:04Z',
            },
          ])}`,
        );
      }
    });
  });
  await page.goto(`/s/${id}`);
  await expect(page.getByRole('heading', { name: 'Synthetic customer' })).toBeVisible();
  return { resolved };
}

test('shows what the customer said, the script hint and the suggested step', async ({ page }) => {
  const { resolved } = await desktop(page);
  const prompts = page.getByRole('region', { name: 'Suggestions from the conversation' });
  await expect(prompts.getByText('I want to cancel my subscription')).toBeVisible();
  await expect(prompts.getByText('Offer the loyalty discount first.')).toBeVisible();
  await expect(prompts.getByRole('button', { name: 'Go to Retention offer' })).toBeVisible();
  await page.getByRole('tab', { name: 'Live transcript' }).click();
  const log = page.getByRole('log', { name: 'Live transcript' });
  await expect(log.getByText('Good morning, how can I help?')).toBeVisible();
  await expect(log.getByText('I want to cancel my subscription')).toBeVisible();
  await prompts.getByRole('button', { name: 'Not now' }).click();
  await expect(prompts).toBeHidden();
  expect(resolved).toEqual([expect.objectContaining({ resolution: 'dismissed' })]);
});

for (const theme of ['light', 'dark', 'high-contrast'])
  test(`prompts and live transcript have no axe violations (${theme})`, async ({ page }) => {
    await page.addInitScript((value) => {
      localStorage.setItem('verbis.theme', value);
    }, theme);
    await desktop(page);
    await expect(page.getByText('Offer the loyalty discount first.')).toBeVisible();
    await page.getByRole('tab', { name: 'Live transcript' }).click();
    await expect(page.getByRole('log', { name: 'Live transcript' })).toBeVisible();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
  });
