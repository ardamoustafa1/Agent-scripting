import { AxeBuilder } from '@axe-core/playwright';

import { ScriptDocumentSchema } from '@verbis/script-schema';
import { VALID_FIXTURES } from '@verbis/script-schema/fixtures';
import { TEMPLATE_SCENARIOS } from '@verbis/script-schema/templates';

import { expect, test, type Page } from '../../../tests/playwright/test.js';
import { editorFixture } from '../src/editor/fixtures.js';
import {
  fixtureResponse,
  scriptId,
  sessionFixture,
  tenantId,
  permissionFixture,
} from '../src/test-fixtures.js';

// DIFFERENTIATORS wave 2: building blocks, data map, branch coverage and time travel.
test.use({ locale: 'en-US' });
const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

async function open(page: Page, document?: unknown) {
  await page.addInitScript(
    ({ tenant, user }) => {
      localStorage.setItem(`verbis.tour.${tenant}.${user}`, 'done');
      localStorage.setItem('verbis.theme', 'light');
    },
    { tenant: tenantId, user: sessionFixture.user.id },
  );
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const version = editorFixture();
    const body = url.pathname.endsWith('/versions/1')
      ? document
        ? { ...version, document }
        : version
      : url.pathname.endsWith('/permissions')
        ? { ...permissionFixture, rules: [...permissionFixture.rules, ['update', 'Script']] }
        : route.request().method() === 'PUT'
          ? { version: 2 }
          : fixtureResponse(url.pathname + url.search);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/scripts/${scriptId}/versions/1/edit`);
  await expect(page.locator('.ed-palette-item').first()).toBeVisible();
}
const report = (violations: { id: string; nodes: { target: unknown[] }[] }[]) =>
  violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);

test('a building block adds a tested page and its personal data shows in the data map', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('tab', { name: 'Pages' }).click();
  const blocks = page.getByRole('region', { name: 'Building blocks' });
  await expect(blocks).toBeVisible();
  expect(
    report(
      (await new AxeBuilder({ page }).include('.ed-blocks').withTags(tags).analyze()).violations,
    ),
  ).toEqual([]);
  await blocks.getByRole('button', { name: 'Add building block: Identity check' }).click();
  await expect(page.getByRole('button', { name: /^Script health \d+ of 100/ })).toBeVisible();

  await page.getByRole('button', { name: /^Script health \d+ of 100/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Script health' });
  const map = sheet.getByRole('table', { name: 'Personal data map' });
  await expect(map.getByRole('row', { name: /customerTckn/ })).toContainText('Personal');
  await expect(map.getByRole('row', { name: /customerTckn/ })).toContainText('Agent input');
});

test('coverage measures the saved scenarios of a template and paints the flow', async ({
  page,
}) => {
  const survey = ScriptDocumentSchema.parse({
    ...VALID_FIXTURES['survey'],
    testScenarios: TEMPLATE_SCENARIOS.survey,
  });
  await open(page, survey);
  await page.getByRole('combobox', { name: 'Editor', exact: true }).click();
  await page.getByRole('option', { name: 'Preview / debugger', exact: true }).click();
  await page.getByRole('tab', { name: 'Coverage' }).click();
  await page.getByRole('button', { name: 'Measure coverage' }).click();
  await expect(page.getByText(/^100% of branches tested/)).toBeVisible();
  await expect(page.getByText('Every branch is tested.')).toBeVisible();
  await expect(page.locator('.fd-visited').first()).toBeVisible();
  expect(
    report(
      (await new AxeBuilder({ page }).include('.pv-coverage').withTags(tags).analyze()).violations,
    ),
  ).toEqual([]);
});

test('the debugger steps back and shows what a step changed', async ({ page }) => {
  await open(page);
  await page.getByRole('combobox', { name: 'Editor', exact: true }).click();
  await page.getByRole('option', { name: 'Preview / debugger', exact: true }).click();
  const stepBack = page.getByRole('button', { name: 'Step back' });
  await expect(stepBack).toBeVisible();
  await page.getByRole('tab', { name: 'Variables', exact: true }).click();
  await page.getByRole('textbox', { name: 'Watch expression' }).fill('1 + 2');
  await page.getByRole('button', { name: 'Watch', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Watched expressions' })).toContainText('3');
  expect(
    report(
      (await new AxeBuilder({ page }).include('.pv-watches').withTags(tags).analyze()).violations,
    ),
  ).toEqual([]);
});
