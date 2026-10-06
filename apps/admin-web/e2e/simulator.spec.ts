import { AxeBuilder } from '@axe-core/playwright';

import { serializeRules } from '@verbis/authz';

import { expect, test, type Page } from '../../../tests/playwright/test.js';

test.use({ locale: 'en-US' });

const CONNECTOR = '0190f000-0000-7000-8000-0000000000s1';
const CSRF = 'csrf-sim';

interface Sim {
  platformInteractionId: string;
  channel: string;
  agentPlatformUserId: string;
  status: string;
  updatedAt: string;
}

/** API mocked: pins the browser contract (BFF only, CSRF on writes, no hub access). */
async function mockApi(page: Page) {
  const interactions: Sim[] = [];
  const posts: { url: string; body: unknown }[] = [];
  let n = 0;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/health/ready')
      return route.fulfill({ status: 503, body: '{"status":"error"}' });
    if (url.pathname === '/api/auth/session/status')
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { id: 'u', tenantId: 't', authMethod: 'sso' },
          session: { id: 's', protocol: 'oidc', expiresAt: '2026-10-01T18:00:00.000Z' },
          csrfToken: CSRF,
        }),
      });
    if (url.pathname === '/api/v1/me/permissions')
      return route.fulfill({
        json: {
          principal: { type: 'user', id: 'u', tenantId: '01990000-0000-7000-8000-000000000001' },
          roles: ['tenant_admin'],
          rules: serializeRules([{ action: 'manage', subject: 'all' }]),
          separationOfDuties: true,
        },
      });
    if (url.pathname === '/api/v1/tenant')
      return route.fulfill({
        json: {
          id: '01990000-0000-7000-8000-000000000001',
          name: 'Fixture tenant',
          settings: {},
          version: 1,
        },
      });
    if (url.pathname === '/api/v1/connectors')
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: CONNECTOR,
              adapterType: 'generic',
              config: { kind: 'simulator' },
              status: 'active',
            },
          ],
          page: {},
        }),
      });
    if (request.method() === 'POST') {
      expect(request.headers()['x-csrf-token']).toBe(CSRF);
      posts.push({ url: url.pathname, body: request.postDataJSON() });
    }
    if (url.pathname === `/api/v1/simulator/connectors/${CONNECTOR}`)
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ connectorId: CONNECTOR, interactions, commands: [] }),
      });
    if (url.pathname === `/api/v1/simulator/connectors/${CONNECTOR}/interactions`) {
      const body = request.postDataJSON() as { channel: string; agentPlatformUserId: string };
      n += 1;
      const sim = {
        platformInteractionId: `sim-${String(n)}`,
        channel: body.channel,
        agentPlatformUserId: body.agentPlatformUserId,
        status: 'alerting',
        updatedAt: '',
      };
      interactions.push(sim);
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(sim),
      });
    }
    const action = /\/interactions\/(sim-\d+)\/actions$/.exec(url.pathname);
    if (action) {
      const sim = interactions.find((i) => i.platformInteractionId === action[1]);
      const next = {
        connect: 'connected',
        hold: 'held',
        resume: 'connected',
        end: 'ended',
        wrapup: 'wrapup',
      } as Record<string, string>;
      if (sim)
        sim.status = next[(request.postDataJSON() as { action: string }).action] ?? sim.status;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(sim ?? {}),
      });
    }
    return route.fulfill({ status: 404, body: '{}' });
  });
  return { posts, interactions };
}

test('creates a simulated chat and drives it through its lifecycle', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto('/#simulator');
  await expect(
    page.getByRole('heading', { name: 'Interaction Simulator', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Channel').selectOption('chat');
  await page.getByLabel('Agent platform user id').fill('sim-agent-1');
  await page.getByLabel('First customer message').fill('Merhaba');
  await page.getByRole('button', { name: 'Start interaction' }).click();
  await expect(page.getByRole('cell', { name: 'Ringing' })).toBeVisible();
  expect(api.posts[0]).toMatchObject({
    body: {
      channel: 'chat',
      agentPlatformUserId: 'sim-agent-1',
      message: 'Merhaba',
      autoConnect: false,
    },
  });
  await page.getByRole('button', { name: 'Answer: Chat for sim-agent-1' }).click();
  await expect(page.getByRole('cell', { name: 'Connected' })).toBeVisible();
  await page.getByRole('button', { name: 'Hold: Chat for sim-agent-1' }).click();
  await expect(page.getByRole('cell', { name: 'On hold' })).toBeVisible();
  expect(api.posts.map((p) => (p.body as { action?: string }).action).filter(Boolean)).toEqual([
    'connect',
    'hold',
  ]);
});

test('simulator is keyboard operable and has no WCAG 2.2 AA violations', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#simulator');
  await expect(
    page.getByRole('heading', { name: 'Interaction Simulator', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Agent platform user id').focus();
  await page.keyboard.type('kbd-agent');
  await page.getByRole('button', { name: 'Start interaction' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('cell', { name: 'kbd-agent', exact: true })).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});
