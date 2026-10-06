import { AxeBuilder } from '@axe-core/playwright';

import { expect, test } from '../../../tests/playwright/test.js';
import {
  fixtureResponse,
  campaignId,
  permissionFixture,
  sessionFixture,
  tenantId,
} from '../src/test-fixtures.js';

test.use({ locale: 'en-US' });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ tenant, user }) => {
      localStorage.setItem(`verbis.tour.${tenant}.${user}`, 'done');
    },
    { tenant: tenantId, user: sessionFixture.user.id },
  );
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    (route) => {
      const url = new URL(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fixtureResponse(url.pathname + url.search)),
      });
    },
  );
});
test('new workspace stays light on a dark operating system with a navy rail', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/campaigns');
  await expect(page.locator('.dw-workspace')).toBeVisible();
  await expect(page.locator('.vb-theme')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.dw-workspace')).toHaveCSS('background-color', 'rgb(246, 247, 249)');
  await expect(page.locator('.dw-topbar')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.locator('.dw-rail')).toHaveCSS('background-color', 'rgb(16, 18, 37)');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

for (const width of [320, 1440])
  test(`sidebar footer stays visible and usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 600 });
    await page.goto('/campaigns');
    const footer = page.locator('.dw-rail-footer');
    await expect(footer).toBeVisible();
    const before = await footer.boundingBox();
    expect(before).not.toBeNull();
    expect(before!.y + before!.height).toBeLessThanOrEqual(600);
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    const after = await footer.boundingBox();
    expect(after!.y).toBeCloseTo(before!.y, 0);
    await footer.getByRole('button', { name: 'Profile menu' }).click();
    await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
    await page.keyboard.press('Escape');
    await footer.getByRole('button', { name: 'Help', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.locator('.dw-rail nav').getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(page).toHaveURL(/\/settings$/);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

for (const theme of ['light', 'dark', 'high-contrast'])
  test(`workspace ${theme}: axe, command navigation and cards`, async ({ page }) => {
    await page.addInitScript((value) => {
      localStorage.setItem('verbis.theme', value);
    }, theme);
    await page.goto('/campaigns');
    await expect(page.getByText('Demo campaign')).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Card view' }).click();
    await expect(page.locator('.dw-resource-card')).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
test('campaign assignments and mappings are reachable by keyboard', async ({ page }) => {
  await page.goto(`/campaigns/${campaignId}`);
  await expect(page.getByText('control: 50% / variant: 50%')).toBeVisible();
  await page.getByRole('tab', { name: 'External mappings' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('fixture-queue')).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test('direct forbidden routes cannot expose the campaigns list', async ({ page }) => {
  await page.route('**/api/v1/me/permissions', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ...permissionFixture, rules: [['read', 'Script']] }),
    }),
  );
  await page.goto('/campaigns');
  await expect(page.getByText('You do not have access to this area')).toBeVisible();
  await expect(page.getByText('Demo campaign')).toHaveCount(0);
});
test('health endpoint responds', async ({ request }) => {
  const response = await request.get('/health');
  expect(response.ok()).toBe(true);
});

test('changing sign-in email discards completed and late SSO discovery', async ({ page }) => {
  await page.route('**/api/auth/session', (route) => route.fulfill({ status: 401, json: {} }));
  let release!: () => void;
  let started!: () => void;
  const arrived = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  await page.route('**/api/auth/discover', async (route) => {
    calls++;
    if (calls === 2) {
      started();
      await pending;
    }
    await route.fulfill({
      json: {
        tenant: 'first',
        providers: [{ id: 'first-idp', displayName: 'First SSO', protocol: 'oidc' }],
      },
    });
  });
  await page.goto('/');
  const email = page.getByLabel('Work email');
  await email.fill('user@first.test');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const provider = page.getByRole('link', { name: 'First SSO' });
  await expect(provider).toBeVisible();
  await email.fill('user@second.test');
  await expect(provider).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await arrived;
  await email.fill('user@third.test');
  const response = page.waitForResponse('**/api/auth/discover');
  release();
  await response;
  await expect(provider).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(provider).toBeVisible();
  expect(calls).toBe(3);
});

test('SSO sign-out follows the identity provider logout URL returned by the BFF', async ({
  page,
}) => {
  await page.route('**/api/auth/logout', (route) =>
    route.fulfill({ json: { redirectUrl: 'https://idp.example.test/logout?state=synthetic' } }),
  );
  await page.route('https://idp.example.test/logout?state=synthetic', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<main>Signed out</main>' }),
  );
  await page.goto('/campaigns');
  await page.getByRole('button', { name: 'User menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL('https://idp.example.test/logout?state=synthetic');
  await expect(page.getByText('Signed out', { exact: true })).toBeVisible();
});

for (const width of [320, 768, 1440])
  test(`navigation remains reachable in a short ${width}px viewport`, async ({ page }) => {
    await page.route('**/api/v1/me/permissions', (route) =>
      route.fulfill({ json: { ...permissionFixture, rules: [['manage', 'all']] } }),
    );
    await page.setViewportSize({ width, height: 600 });
    await page.goto('/campaigns');
    await expect(page.getByText('Demo campaign', { exact: true })).toBeVisible();
    const settings = page.getByRole('link', { name: 'Settings', exact: true });
    await settings.focus();
    await expect(settings).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole('button', { name: 'User menu', exact: true })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `test-results/workspace-${width}-short.png`, fullPage: true });
  });

test('a failed library page preserves cards and recovers without losing filters', async ({
  page,
}) => {
  let attempts = 0;
  await page.route('**/api/v1/scripts?*', (route) => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor');
    if (!cursor)
      return route.fulfill({
        json: {
          data: [{ id: 'first', name: 'First library script', tags: ['library'] }],
          page: { nextCursor: 'next' },
        },
      });
    attempts++;
    // Both the initial attempt and the configured automatic retry fail.
    return attempts <= 2
      ? route.fulfill({ status: 503, json: { code: 'VERBIS_HTTP_UNAVAILABLE' } })
      : route.fulfill({
          json: {
            data: [{ id: 'second', name: 'Second library script', tags: ['library'] }],
            page: { nextCursor: null },
          },
        });
  });
  await page.goto('/scripts');
  await page.getByRole('button', { name: 'Card view', exact: true }).click();
  await expect(page.getByRole('button', { name: 'First library script' })).toBeVisible();
  await page.getByLabel('Search this list').fill('library');
  await page.getByRole('button', { name: 'Load more', exact: true }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible();
  await expect(page.getByRole('button', { name: 'First library script' })).toBeVisible();
  await expect(page.getByLabel('Search this list')).toHaveValue('library');
  await alert.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Second library script' })).toBeVisible();
  await expect(alert).toHaveCount(0);
  await page.getByLabel('Search this list').fill('no-such-script');
  await expect(page.getByText('No results match your search')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page.getByRole('button', { name: 'First library script' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Second library script' })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

for (const theme of ['light', 'dark', 'high-contrast'])
  for (const width of [320, 1440])
    test(`sidebar toggle ${theme} ${width}: width, navigation and persistence`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 600 });
      await page.addInitScript((theme) => {
        localStorage.setItem('verbis.theme', theme);
      }, theme);
      await page.goto('/campaigns');
      const rail = page.locator('.dw-rail');
      const expanded = (await rail.boundingBox())!.width;
      const bodyBefore = (await page.locator('.dw-body').boundingBox())!.width;
      const toggle = page.getByRole('button', { name: 'Collapse sidebar', exact: true });
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await toggle.focus();
      await page.keyboard.press('Enter');
      const open = page.getByRole('button', { name: 'Expand sidebar', exact: true });
      await expect(open).toHaveAttribute('aria-expanded', 'false');
      await expect(rail).toHaveCSS('width', '64px');
      expect((await page.locator('.dw-body').boundingBox())!.width).toBeGreaterThan(bodyBefore);
      await expect(rail.locator('.dw-nav span').first()).toBeHidden();
      await rail.getByRole('link', { name: 'Scripts', exact: true }).click();
      await expect(page).toHaveURL(/\/scripts$/);
      await page.reload();
      await expect(page.getByRole('button', { name: 'Expand sidebar', exact: true })).toBeVisible();
      await expect(rail).toHaveCSS('width', '64px');
      await expect(rail.getByRole('button', { name: 'Profile menu' })).toBeVisible();
      await expect(rail.getByRole('button', { name: 'Help', exact: true })).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: `test-results/sidebar-collapsed-${theme}-${width}.png`,
        fullPage: true,
      });
      await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Collapse sidebar', exact: true }),
      ).toBeVisible();
      expect((await rail.boundingBox())!.width).toBe(expanded);
      expect(await page.evaluate(() => localStorage.getItem('verbis.sidebar.collapsed'))).toBe(
        'false',
      );
    });
