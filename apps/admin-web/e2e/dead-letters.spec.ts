/// <reference lib="dom" />
import { AxeBuilder } from '@axe-core/playwright';

import { serializeRules } from '@verbis/authz';

import { expect, test } from '../../../tests/playwright/test.js';

test.use({ locale: 'en-US' });

const tenant = '01990000-0000-7000-8000-000000000001',
  user = '01990000-0000-7000-8000-000000000002';

// Connector hub DLQ replay (ADR-0041): keyboard-only operation, CSRF, bounded body, axe clean.
for (const theme of ['light', 'dark'])
  test(`dead-letter replay is keyboard operable and axe clean (${theme})`, async ({ page }) => {
    const posts: { url: string; body: unknown; csrf: string | undefined }[] = [];
    await page.addInitScript((value) => {
      localStorage.setItem('verbis.theme', value);
    }, theme);
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === '/api/auth/session/status')
        return route.fulfill({
          json: {
            user: { id: user, tenantId: tenant, authMethod: 'sso' },
            session: { id: 'session', protocol: 'oidc', expiresAt: '2099-10-03T12:00:00Z' },
            csrfToken: 'csrf-dlq',
          },
        });
      if (path === '/api/v1/me/permissions')
        return route.fulfill({
          json: {
            principal: { type: 'user', id: user, tenantId: tenant },
            roles: ['tenant_admin'],
            rules: serializeRules([{ action: 'manage', subject: 'all' }]),
            separationOfDuties: true,
          },
        });
      if (path === '/api/v1/connector-dead-letters/replay') {
        posts.push({
          url: path,
          body: request.postDataJSON() as unknown,
          csrf: request.headers()['x-csrf-token'],
        });
        return route.fulfill({ json: { replayed: 3 } });
      }
      if (path === '/api/v1/connector-dead-letters')
        return route.fulfill({ json: { durable: true, persisted: 7, persistFailures: 0 } });
      if (path === '/api/health/ready') return route.fulfill({ json: { status: 'ok' } });
      return route.fulfill({ json: [] });
    });
    await page.goto('/#systemHealth');
    const heading = page.getByRole('heading', { name: 'Connector dead-letter queue' });
    await expect(heading).toBeVisible();
    await expect(page.getByText('7', { exact: true })).toBeVisible();

    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
      .analyze();
    expect(
      violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);

    const limit = page.getByLabel('Maximum events to replay');
    await limit.fill('25');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Replay dead letters' })).toBeFocused();
    await page.keyboard.press('Enter');
    expect(posts).toHaveLength(0); // confirmation first
    await page.getByRole('button', { name: 'Confirm action' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Events re-offered: 3')).toBeVisible();
    expect(posts).toEqual([
      { url: '/api/v1/connector-dead-letters/replay', body: { limit: 25 }, csrf: 'csrf-dlq' },
    ]);
  });
