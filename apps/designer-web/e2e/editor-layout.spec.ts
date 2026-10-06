/// <reference lib="dom" />
import { AxeBuilder } from '@axe-core/playwright';

import { expect, test } from '../../../tests/playwright/test.js';
import { editorFixture } from '../src/editor/fixtures.js';
import {
  fixtureResponse,
  scriptId,
  sessionFixture,
  tenantId,
  permissionFixture,
} from '../src/test-fixtures.js';

for (const theme of ['light', 'dark', 'high-contrast']) {
  for (const width of [320, 768, 1440]) {
    test(`editor controls ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.addInitScript(
        ({ theme, tenant, user }) => {
          localStorage.setItem('verbis.theme', theme);
          localStorage.setItem(`verbis.tour.${tenant}.${user}`, 'done');
          Object.defineProperty(navigator, 'languages', { get: () => ['tr'] });
        },
        { theme, tenant: tenantId, user: sessionFixture.user.id },
      );
      await page.route(
        (url) => url.pathname.startsWith('/api/'),
        (route) => {
          const url = new URL(route.request().url());
          const fixture = editorFixture();
          fixture.document.meta.name = 'Müşteri karşılama';
          return route.fulfill({
            json: url.pathname.endsWith('/versions/1')
              ? fixture
              : url.pathname.endsWith('/permissions')
                ? {
                    ...permissionFixture,
                    rules: [...permissionFixture.rules, ['update', 'Script']],
                  }
                : fixtureResponse(url.pathname + url.search),
          });
        },
      );
      await page.goto(`/scripts/${scriptId}/versions/1/edit`);
      await expect(page.locator('.ed-document-title')).toBeVisible();
      await page.locator('.ed-left .vb-tab').nth(1).click();
      await page.locator('[data-layer-id="btn-next"]').getByRole('button').last().click();
      await expect(page.locator('.ed-layout-handles')).toBeVisible();
      const controls = await page
        .locator(
          '.ed-commands .vb-button, .ed-mode-shortcuts .vb-button, .lc-presence .vb-button, .ed-canvas-heading .vb-button',
        )
        .evaluateAll((els) =>
          els.map((el) => {
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
          }),
        );
      for (let i = 0; i < controls.length; i++) {
        for (let j = i + 1; j < controls.length; j++) {
          const a = controls[i]!,
            b = controls[j]!;
          expect(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y).toBe(true);
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      for (const selector of ['.ed-left', '.ed-inspector']) {
        const clipped = await page.locator(selector).evaluate((panel) => {
          const r = panel.getBoundingClientRect();
          return [...panel.querySelectorAll('.vb-tab')].some(
            (tab) => tab.getBoundingClientRect().right > r.right + 1,
          );
        });
        expect(clipped).toBe(false);
      }
      expect(await page.locator('.ed-selection .ed-layout-handles').count()).toBe(0);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });
      await expect(page).toHaveScreenshot(`editor-controls-${theme}-${width}.png`, {
        fullPage: true,
      });
    });
  }
}

test('desktop editor uses viewport height and fullscreen retains the editing state', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(
    ({ tenant, user }) => {
      localStorage.setItem(`verbis.tour.${tenant}.${user}`, 'done');
      Object.defineProperty(navigator, 'languages', { get: () => ['en'] });
    },
    { tenant: tenantId, user: sessionFixture.user.id },
  );
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    (route) => {
      const url = new URL(route.request().url());
      return route.fulfill({
        json: url.pathname.endsWith('/versions/1')
          ? editorFixture()
          : url.pathname.endsWith('/permissions')
            ? { ...permissionFixture, rules: [...permissionFixture.rules, ['update', 'Script']] }
            : fixtureResponse(url.pathname + url.search),
      });
    },
  );
  await page.goto(`/scripts/${scriptId}/versions/1/edit`);
  await expect(page.locator('.ed-workspace')).toBeVisible();
  await page.locator('.ed-left .vb-tab').nth(1).click();
  await page.locator('[data-layer-id="btn-next"]').getByRole('button').last().click();
  const before = (await page.locator('.ed-canvas').boundingBox())!;
  expect(before.height).toBeGreaterThan(450);
  const workspace = (await page.locator('.ed-workspace').boundingBox())!;
  expect(workspace.y + workspace.height).toBeLessThanOrEqual(900);
  const selected = await page.locator('.ed-selection').boundingBox();
  expect(selected).not.toBeNull();
  await page.getByRole('button', { name: 'Work fullscreen', exact: true }).click();
  await expect(page.locator('.ed-workspace')).toHaveAttribute('data-expanded', 'true');
  await expect(page.locator('.dw-topbar')).toBeHidden();
  await expect(page.locator('.dw-rail')).toBeHidden();
  const full = (await page.locator('.ed-canvas').boundingBox())!;
  expect(full.height).toBeGreaterThan(before.height);
  expect(full.width).toBeGreaterThan(before.width);
  await expect(page.locator('[data-layer-id="btn-next"]')).toHaveAttribute('aria-selected', 'true');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('combobox', { name: 'Breakpoint' }).click();
  await page.getByRole('option', { name: 'Wide desktop · 1280' }).click();
  await page.getByRole('button', { name: 'Fit to canvas', exact: true }).click();
  const fit = await page.locator('.ed-paper').boundingBox();
  const canvas = await page.locator('.ed-canvas').boundingBox();
  expect(fit!.width).toBeLessThanOrEqual(canvas!.width);
  await expect(page.locator('[data-layer-id="btn-next"]')).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('combobox', { name: 'Breakpoint' }).click();
  await page.getByRole('option', { name: 'Mobile · 375' }).click();
  await page.getByRole('button', { name: 'Fit to canvas', exact: true }).click();
  await expect(page).toHaveScreenshot('editor-fullscreen-desktop.png');
  await page.keyboard.press('Escape');
  await expect(page.locator('.ed-workspace')).toHaveAttribute('data-expanded', 'false');
  await expect(page.locator('.dw-rail')).toBeVisible();
  await expect(page.locator('[data-layer-id="btn-next"]')).toHaveAttribute('aria-selected', 'true');
  expect((await page.locator('.ed-canvas').boundingBox())!.height).toBeCloseTo(before.height);
});
