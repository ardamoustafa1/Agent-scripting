import { AxeBuilder } from '@axe-core/playwright';

import { createI18n } from '@verbis/i18n';

import { expect, test } from '../../../tests/playwright/test.js';
import { editorFixture } from '../src/editor/fixtures.js';
import {
  fixtureResponse,
  scriptId,
  sessionFixture,
  tenantId,
  permissionFixture,
} from '../src/test-fixtures.js';

for (const language of ['tr', 'en'] as const) {
  test.describe(`competitive authoring ${language}`, () => {
    test.use({ locale: language === 'tr' ? 'tr-TR' : 'en-US' });
    for (const theme of ['light', 'dark', 'high-contrast']) {
      for (const width of [320, 1440]) {
        test(`${theme} ${width}: translated search, page filter and read-only navigation`, async ({
          page,
        }) => {
          const i18n = await createI18n(language);
          const label = (key: string) => i18n.t(`designer.editor.${key}`);
          const fixture = editorFixture();
          fixture.document.pages[0]!.layout.children![0]!['props'] = { labelKey: 'delivery.help' };
          fixture.document.i18n.messages['tr']!['delivery.help'] = 'Kargo desteği';
          fixture.document.i18n.messages['en']!['delivery.help'] = 'Delivery assistance';
          const second = structuredClone(fixture.document.pages[0]!);
          second.id = 'delivery';
          second.name = 'Kargo desteği';
          second.layout.id = 'delivery-root';
          second.layout.children![0]!['id'] = 'delivery-next';
          fixture.document.pages.push(second);
          const mutations: string[] = [];
          await page.setViewportSize({ width, height: 1000 });
          await page.addInitScript(
            ({ theme, tenant, user }) => {
              localStorage.setItem('verbis.theme', theme);
              localStorage.setItem(`verbis.tour.${tenant}.${user}`, 'done');
            },
            { theme, tenant: tenantId, user: sessionFixture.user.id },
          );
          await page.route('**/api/**', async (route) => {
            const url = new URL(route.request().url());
            if (!['GET', 'HEAD'].includes(route.request().method())) mutations.push(url.pathname);
            const body = url.pathname.endsWith('/versions/1')
              ? fixture
              : url.pathname.endsWith('/permissions')
                ? {
                    ...permissionFixture,
                    rules: [...permissionFixture.rules, ['update', 'Script']],
                  }
                : fixtureResponse(url.pathname + url.search);
            return route.fulfill({ json: body });
          });
          await page.goto(`/scripts/${scriptId}/versions/1/edit`);
          const panel = page.locator('.ed-left');
          await panel.getByRole('tab', { name: label('layers'), exact: true }).click();
          await panel
            .getByRole('textbox', { name: label('findNode') })
            .fill(language === 'tr' ? ' KARGO DESTEGI ' : ' DELIVERY ASSISTANCE ');
          const results = panel.getByRole('region', { name: label('nodeResults') });
          await expect(results.getByRole('button', { name: /delivery-next/ })).toBeVisible();
          await results.getByRole('button', { name: /delivery-next/ }).click();
          await expect(page.locator('.ed-inspector')).toContainText('delivery-next');
          await panel.getByRole('tab', { name: label('pages'), exact: true }).click();
          await panel.getByRole('textbox', { name: label('findPage') }).fill('kargo destegi');
          await expect(panel.getByRole('button', { name: 'Home', exact: true })).toHaveCount(0);
          await expect(panel.getByRole('button', { name: second.name, exact: true })).toBeVisible();
          await panel.getByRole('textbox', { name: label('findPage') }).fill('not-present');
          await expect(panel.getByText(label('noMatchingPages'))).toBeVisible();
          await panel.getByRole('textbox', { name: label('findPage') }).fill('delivery');
          await panel.getByRole('button', { name: second.name, exact: true }).click();
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
          expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
          expect(mutations).toEqual([]);
          if (width === 320) {
            const canvas = page.locator('.ed-canvas');
            await canvas.focus();
            await canvas.press('ArrowRight');
            await expect
              .poll(() => canvas.evaluate((element) => element.scrollLeft))
              .toBeGreaterThan(0);
          }
          await page.screenshot({
            path: `../../artifacts/competitive-authoring-20261006/pages-${language}-${theme}-${width}.png`,
            fullPage: true,
          });
        });
      }
    }
  });
}

test('large component search keeps every match reachable with bounded result DOM', async ({
  page,
}) => {
  await page.addInitScript(
    ({ tenant, user }) => {
      localStorage.setItem(`verbis.tour.${tenant}.${user}`, 'done');
      Object.defineProperty(navigator, 'languages', { get: () => ['en'] });
    },
    { tenant: tenantId, user: sessionFixture.user.id },
  );
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({
      json: url.pathname.endsWith('/versions/1')
        ? editorFixture(1000)
        : url.pathname.endsWith('/permissions')
          ? { ...permissionFixture, rules: [...permissionFixture.rules, ['update', 'Script']] }
          : fixtureResponse(url.pathname + url.search),
    });
  });
  await page.goto(`/scripts/${scriptId}/versions/1/edit`);
  await page.locator('.ed-left').getByRole('tab', { name: 'Layers', exact: true }).click();
  await page.getByRole('textbox', { name: 'Find component across all pages' }).fill('box');
  const results = page.getByRole('region', { name: 'Component results' });
  expect(await results.getByRole('button').count()).toBeLessThan(60);
  await results.getByRole('button', { name: 'Next results', exact: true }).click();
  await results.getByRole('button', { name: /fixture-49/ }).click();
  await expect(page.locator('.ed-inspector')).toContainText('fixture-49');
  await expect(results.getByRole('status')).toContainText('51–100 / 1000');
  await page.screenshot({
    path: '../../artifacts/competitive-authoring-20261006/large-search.png',
    fullPage: true,
  });
});

test('failed or stale regression revokes publish readiness and a valid rerun recovers', async ({
  page,
}) => {
  await page.addInitScript(
    ({ tenant, user }) => {
      localStorage.setItem(`verbis.tour.${tenant}.${user}`, 'done');
      Object.defineProperty(navigator, 'languages', { get: () => ['en'] });
    },
    { tenant: tenantId, user: sessionFixture.user.id },
  );
  let attempt = 0,
    published = false;
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/versions/2/regression')) {
      attempt++;
      if (attempt === 2) return route.fulfill({ status: 500, json: {} });
      return route.fulfill({
        json: {
          checksum: 'a'.repeat(64),
          version: attempt === 3 ? 8 : 7,
          passed: true,
          checkedAt: '2026-10-06T00:00:00Z',
          results: [
            {
              id: 'synthetic-end',
              passed: true,
              durationMs: 1,
              assertions: [{ path: 'ended', passed: true }],
            },
          ],
        },
      });
    }
    if (url.pathname.endsWith('/publish')) {
      published = true;
      return route.fulfill({ json: {} });
    }
    const body = url.pathname.endsWith('/versions/2')
      ? { ...editorFixture(), number: 2, version: 7, state: 'approved' }
      : url.pathname.endsWith('/permissions')
        ? { ...permissionFixture, rules: [...permissionFixture.rules, ['publish', 'Script']] }
        : fixtureResponse(url.pathname + url.search);
    return route.fulfill({ json: body });
  });
  await page.goto(`/scripts/${scriptId}/versions/2/release`);
  const panel = page.getByRole('region', { name: 'Pre-publication regression' });
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();
  const publish = panel.getByRole('button', { name: 'Publish version', exact: true });
  const run = panel.getByRole('button', { name: 'Run saved scenarios', exact: true });
  await expect(publish).toBeDisabled();
  await run.click();
  await expect(publish).toBeEnabled();
  await run.click();
  await expect(panel.getByRole('alert')).toBeVisible();
  await expect(publish).toBeDisabled();
  await run.click();
  await expect(
    panel.getByText('This result does not match the saved document. Run regression again.'),
  ).toBeVisible();
  await expect(publish).toBeDisabled();
  await page.screenshot({
    path: '../../artifacts/competitive-authoring-20261006/stale-regression.png',
    fullPage: true,
  });
  await run.click();
  await expect(publish).toBeEnabled();
  expect(published).toBe(false);
});
