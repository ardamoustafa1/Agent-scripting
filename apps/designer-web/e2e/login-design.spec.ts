/// <reference lib="dom" />
import { AxeBuilder } from '@axe-core/playwright';

import { expect, test } from '../../../tests/playwright/test.js';

test.use({ locale: 'en-US' });
test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/session', (route) => route.fulfill({ status: 401, json: {} }));
});

for (const width of [320, 390, 768, 1440]) {
  test(`entry design ${width}: accessible and no horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByLabel('Work email')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole('button', { name: 'Pause animation' }).click();
    await expect(page.locator('main')).toHaveAttribute('data-motion', 'paused');
    await page.screenshot({
      path: test.info().outputPath(`login-entry-${width}.png`),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Türkçeye geç' }).hover();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole('button', { name: 'Türkçeye geç' }).click();
    await page.mouse.move(0, 0);
    await expect(page.getByLabel('İş e-postası')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: test.info().outputPath(`login-entry-tr-${width}.png`),
      fullPage: true,
    });
  });
}

test('reduced motion stops decorative effects; keyboard submits real provider discovery', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/auth/discover', (route) =>
    route.fulfill({
      json: {
        tenant: 'verbis-dev',
        providers: [
          {
            id: '01928f3a-0000-7000-8000-00000000d201',
            displayName: 'Keycloak (dev)',
            protocol: 'oidc',
          },
        ],
      },
    }),
  );
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Pause animation' })).toBeHidden();
  expect(
    await page
      .locator('.dw-login-story h1 span')
      .first()
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe('none');
  await expect(page.locator('.dw-atlas-packet').first()).toHaveCSS('animation-name', 'none');
  await page.getByLabel('Work email').fill('admin@verbis.test');
  await page.getByLabel('Work email').press('Enter');
  const provider = page.getByRole('link', { name: 'Keycloak (dev)' });
  await expect(provider).toBeVisible();
  await expect(provider).toHaveAttribute('href', /\/api\/auth\/login\?tenant=verbis-dev/);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('script atlas moves, pauses completely and resumes without interrupting the email', async ({
  page,
}) => {
  await page.goto('/');
  const packet = page.locator('.dw-atlas-packet').first();
  await expect(packet).toBeVisible();
  await page.getByLabel('Work email').fill('admin@verbis.test');
  const offset = () => packet.evaluate((el) => getComputedStyle(el).strokeDashoffset);
  const first = await offset();
  await expect.poll(offset).not.toBe(first);
  await page.getByRole('button', { name: 'Pause animation' }).click();
  await expect(packet).toHaveCSS('animation-play-state', 'paused');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            resolve();
          }),
        ),
      ),
  );
  const paused = await offset();
  await page.waitForTimeout(300);
  expect(await offset()).toBe(paused);
  await page.getByRole('button', { name: 'Play animation' }).click();
  await expect.poll(offset).not.toBe(paused);
  await expect(page.getByLabel('Work email')).toHaveValue('admin@verbis.test');
});

test('a device without WebGL retains the complete sign-in form and static artwork', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext')
      ?.value as HTMLCanvasElement['getContext'];
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value: function (this: HTMLCanvasElement, contextId: string, ...args: unknown[]) {
        if (contextId.startsWith('webgl')) return null;
        return Reflect.apply(original, this, [contextId, ...args]) as RenderingContext | null;
      },
    });
  });
  await page.goto('/');
  await expect(page.getByLabel('Work email')).toBeVisible();
  await expect(page.locator('.dw-sculpture-fallback')).toBeVisible();
  await page.getByLabel('Work email').fill('admin@verbis.test');
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('discovery failure explains recovery and retry preserves the work email', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/auth/discover', (route) => {
    attempts++;
    return attempts === 1
      ? route.fulfill({ status: 503, json: { title: 'Unavailable' } })
      : route.fulfill({ json: { tenant: 'verbis-dev', providers: [] } });
  });
  await page.goto('/');
  await page.getByLabel('Work email').fill('admin@verbis.test');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(
    page.getByText('Could not connect. Your email is saved; you can try again.'),
  ).toBeVisible();
  await expect(page.getByLabel('Work email')).toHaveValue('admin@verbis.test');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('No identity provider was found for this account.')).toBeVisible();
  await expect(
    page.getByText('Check your work email or contact your organization’s administrator.'),
  ).toBeVisible();
  await expect(
    page.getByText('Could not connect. Your email is saved; you can try again.'),
  ).toBeHidden();
  await expect(page.getByLabel('Work email')).toHaveValue('admin@verbis.test');
  expect(attempts).toBe(2);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
