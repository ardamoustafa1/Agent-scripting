import { AxeBuilder } from '@axe-core/playwright';

import { createI18n } from '@verbis/i18n';

import { expect, test, type Page } from '../../../tests/playwright/test.js';
import { editorFixture } from '../src/editor/fixtures.js';
import {
  campaignFixture,
  campaignId,
  fixtureResponse,
  pageFixture,
  permissionFixture,
  scriptFixture,
  scriptId,
  sessionFixture,
  tenantId,
} from '../src/test-fixtures.js';

async function setup(page: Page, locale: 'tr' | 'en', width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(
    ({ locale, tenant, user }) => {
      Object.defineProperty(navigator, 'languages', { get: () => [locale] });
      localStorage.setItem(`verbis.tour.${tenant}.${user}`, 'done');
    },
    { locale, tenant: tenantId, user: sessionFixture.user.id },
  );
  const writes: { path: string; key: string | undefined }[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.pathname.endsWith('/permissions'))
      return route.fulfill({
        json: {
          ...permissionFixture,
          rules: [
            ['read', 'Tenant'],
            ['read', 'Script', { campaignIds: { $in: [campaignId] } }],
            ['create', 'Script', { campaignIds: { $in: [campaignId] } }],
            ['read', 'Campaign', { id: { $in: [campaignId] } }],
          ],
        },
      });
    if (url.pathname === '/api/v1/campaigns')
      return route.fulfill({
        json: pageFixture([
          campaignFixture,
          { ...campaignFixture, id: scriptId, name: 'Outside scope' },
        ]),
      });
    if (url.pathname === '/api/v1/ai/status') return route.fulfill({ json: { enabled: true } });
    if (url.pathname === '/api/v1/templates')
      return route.fulfill({
        json: [{ id: 'builtin-nps-survey', name: 'NPS survey', builtIn: true }],
      });
    if (request.method() === 'POST') {
      expect(request.headers()['x-csrf-token']).toBe(sessionFixture.csrfToken);
      if (url.pathname === '/api/v1/ai/suggestions')
        return route.fulfill({
          json: {
            callId: scriptId,
            task: 'draft',
            requiresHumanApproval: true,
            value: editorFixture().document,
            inputTokens: 10,
            outputTokens: 5,
            maskedCount: 0,
          },
        });
      if (
        url.pathname !== '/api/v1/scripts' &&
        !url.pathname.endsWith('/versions') &&
        !url.pathname.endsWith('/instantiate')
      )
        return route.fulfill({ json: fixtureResponse(url.pathname + url.search) });
      const key = request.headers()['idempotency-key'];
      expect(key).toBeTruthy();
      writes.push({ path: url.pathname, key });
      if (url.pathname.endsWith('/versions')) {
        if (writes.filter((write) => write.path.endsWith('/versions')).length === 1)
          return route.fulfill({ status: 503, json: { code: 'VERBIS_HTTP_UNAVAILABLE' } });
        return route.fulfill({ status: 201, json: { number: 1 } });
      }
      expect(request.postDataJSON()).toMatchObject({ campaignId });
      return route.fulfill({
        status: 201,
        json: url.pathname.endsWith('/instantiate')
          ? { script: { id: scriptId }, version: { number: 1 } }
          : scriptFixture,
      });
    }
    if (url.pathname.endsWith('/versions/1')) return route.fulfill({ json: editorFixture() });
    return route.fulfill({ json: fixtureResponse(url.pathname + url.search) });
  });
  return { writes, i18n: await createI18n(locale) };
}

for (const locale of ['tr', 'en'] as const)
  for (const width of [390, 1440]) {
    test(`AI campaign selection and save recovery ${locale} ${width}`, async ({ page }, info) => {
      const { writes, i18n } = await setup(page, locale, width),
        t = i18n.t.bind(i18n);
      await page.goto('/ai');
      await page.getByLabel(t('ai.source'), { exact: true }).fill('Synthetic service greeting');
      await page.getByRole('button', { name: t('ai.generate'), exact: true }).click();
      const accept = page.getByRole('button', { name: t('ai.accept'), exact: true });
      await expect(accept).toBeDisabled();
      expect(writes).toHaveLength(0);
      const campaign = page.getByLabel(t('designer.workspace.createCampaign'), { exact: true });
      await expect(campaign).toBeEnabled();
      await expect(page.getByRole('option', { name: 'Outside scope' })).toHaveCount(0);
      await campaign.selectOption(campaignId);
      await expect(accept).toBeEnabled();
      const preview = page.getByRole('region', { name: t('ai.preview'), exact: true });
      await expect(preview).toBeVisible();
      expect((await preview.boundingBox())!.height).toBeLessThanOrEqual(386);
      await preview.focus();
      await page.keyboard.press('End');
      await accept.click();
      await expect(page.getByText(t('ai.error'), { exact: true })).toBeVisible();
      await expect(accept).toBeEnabled();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: info.outputPath('ai-reviewed-draft.png'), fullPage: true });
      await accept.click();
      await expect(page).toHaveURL(new RegExp(`/scripts/${scriptId}$`));
      expect(writes.filter((write) => write.path === '/api/v1/scripts')).toHaveLength(1);
      const versions = writes.filter((write) => write.path.endsWith('/versions'));
      expect(versions).toHaveLength(2);
      expect(versions[1]!.key).toBe(versions[0]!.key);
    });

    test(`template campaign selection ${locale} ${width}`, async ({ page }, info) => {
      const { writes, i18n } = await setup(page, locale, width),
        t = i18n.t.bind(i18n);
      await page.goto('/scripts');
      await page
        .getByRole('button', { name: t('designer.workspace.new.scripts'), exact: true })
        .first()
        .click();
      const dialog = page.getByRole('dialog');
      await dialog
        .getByLabel(t('designer.workspace.name'), { exact: true })
        .fill('Synthetic survey');
      await dialog
        .getByRole('radio', { name: t('designer.workspace.startWith.template'), exact: true })
        .check();
      const template = dialog.getByRole('combobox', {
        name: t('designer.workspace.startWith.choose'),
        exact: true,
      });
      await template.click();
      await page
        .getByRole('option', {
          name: t('designer.lifecycle.templates.builtin-nps-survey'),
          exact: true,
        })
        .click();
      const create = dialog.getByRole('button', {
        name: t('designer.workspace.create'),
        exact: true,
      });
      await expect(create).toBeDisabled();
      const campaign = dialog.getByLabel(t('designer.workspace.createCampaign'), { exact: true });
      await expect(page.getByRole('option', { name: 'Outside scope' })).toHaveCount(0);
      await campaign.selectOption(campaignId);
      await expect(create).toBeEnabled();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: info.outputPath('template-campaign.png'), fullPage: true });
      await create.click();
      await expect(page).toHaveURL(new RegExp(`/scripts/${scriptId}/versions/1/edit$`));
      expect(writes).toHaveLength(1);
      expect(writes[0]!.path).toBe('/api/v1/templates/builtin-nps-survey/instantiate');
    });
  }
