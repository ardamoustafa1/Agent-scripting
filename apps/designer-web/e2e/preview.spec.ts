import { AxeBuilder } from '@axe-core/playwright';

import { test, expect, type Page } from '../../../tests/playwright/test.js';
import { editorFixture } from '../src/editor/fixtures.js';
import {
  fixtureResponse,
  scriptId,
  sessionFixture,
  permissionFixture,
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
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    let body: unknown;
    if (url.pathname.endsWith('/versions/1')) body = editorFixture();
    else if (url.pathname.endsWith('/permissions'))
      body = { ...permissionFixture, rules: [...permissionFixture.rules, ['update', 'Script']] };
    else if (url.pathname.endsWith('/regression'))
      body = {
        checksum: 'synthetic-checksum',
        version: 1,
        passed: true,
        checkedAt: '2026-10-02T00:00:00.000Z',
        results: [],
      };
    else if (route.request().method() === 'PUT') body = { version: 2 };
    else body = fixtureResponse(url.pathname + url.search);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
});
async function preview(page: Page) {
  await page.goto(`/scripts/${scriptId}/versions/1/edit`);
  await page
    .getByRole('navigation', { name: 'Editor', exact: true })
    .getByRole('button', { name: 'Preview / debugger', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Language', exact: true }).last().click();
  await page.getByRole('option', { name: 'English', exact: true }).click();
  await expect(
    page
      .frameLocator('iframe[title="Agent screen preview"]')
      // The script's own button; the agent frame's footer has a Next of its own.
      .locator('.pv-agent-runtime')
      .getByRole('button', { name: 'Next', exact: true }),
  ).toBeVisible();
}
for (const width of [390, 768])
  test(`preview stacks controls and keeps its device usable at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await preview(page);
    const sidebar = await page.locator('.pv-sidebar').boundingBox();
    const stage = await page.locator('.pv-stage').boundingBox();
    expect(sidebar).not.toBeNull();
    expect(stage).not.toBeNull();
    expect(stage!.y).toBeGreaterThanOrEqual(sidebar!.y + sidebar!.height);
    expect(stage!.width).toBeGreaterThan(200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`preview-${width}.png`), fullPage: true });
  });

test('compact editor retains visible collaboration connection feedback', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/scripts/${scriptId}/versions/1/edit`);
  await expect(
    page.getByRole('button', { name: 'Join collaborative editing', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.lc-presence .vb-badge')).toBeVisible();
});
test('mobile editor keeps collaboration actions within its workspace', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`/scripts/${scriptId}/versions/1/edit`);
  const join = page.getByRole('button', { name: 'Join collaborative editing', exact: true });
  await expect(join).toBeVisible();
  const button = await join.boundingBox();
  const workspace = await page.locator('.ed-workspace').boundingBox();
  expect(button!.x + button!.width).toBeLessThanOrEqual(workspace!.x + workspace!.width);
});
test('runs actual runtime in a device frame and restores a selected state', async ({ page }) => {
  await preview(page);
  await page
    .frameLocator('iframe[title="Agent screen preview"]')
    .locator('.pv-agent-runtime')
    .getByRole('button', { name: 'Next', exact: true })
    .click();
  await expect(page.locator('.fd-visited-edge')).not.toHaveCount(0);
  await page
    .getByRole('button', { name: 'Return to this moment', exact: true, disabled: false })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save scenario', exact: true })).toBeDisabled();
});
test('device preview blocks scripts and inline event handlers from frame content', async ({
  page,
}) => {
  await preview(page);
  await page.locator('iframe[title="Agent screen preview"]').evaluate((element) => {
    interface CanaryElement {
      textContent: string | null;
      setAttribute: (name: string, value: string) => void;
      click: () => void;
    }
    const frame = element as unknown as {
      contentDocument: {
        body: { append: (element: CanaryElement) => void };
        createElement: (tag: string) => CanaryElement;
      } | null;
    };
    const body = frame.contentDocument?.body;
    if (!body) throw new Error('Preview frame missing');
    const script = frame.contentDocument!.createElement('script');
    script.textContent = 'document.body.dataset.scriptCanary="executed"';
    body.append(script);
    const button = frame.contentDocument!.createElement('button');
    button.setAttribute('onclick', 'document.body.dataset.inlineCanary="executed"');
    button.textContent = 'Synthetic script canary';
    body.append(button);
    button.click();
  });
  const body = page.frameLocator('iframe[title="Agent screen preview"]').locator('body');
  await expect(body).not.toHaveAttribute('data-script-canary', 'executed');
  await expect(body).not.toHaveAttribute('data-inline-canary', 'executed');
});
test('records a synthetic session with CSRF and disables live mode without permission', async ({
  page,
}) => {
  await preview(page);
  await page.getByRole('button', { name: 'Save scenario', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Scenario name').fill('Synthetic smoke');
  await dialog.getByRole('checkbox').check();
  const saved = page.waitForRequest(
    (request) => request.method() === 'PUT' && request.url().endsWith('/document'),
  );
  await dialog.getByRole('button', { name: 'Save scenario', exact: true }).click();
  const request = await saved;
  expect(request.headers()['x-csrf-token']).toBe(sessionFixture.csrfToken);
  expect(request.postDataJSON()).toMatchObject({
    document: {
      testScenarios: [{ synthetic: true, name: 'Synthetic smoke', expected: { page: 'home' } }],
    },
  });
});
for (const theme of ['light', 'dark', 'high-contrast'])
  test(`preview ${theme} keyboard and accessibility`, async ({ page }) => {
    await preview(page);
    await page.getByRole('combobox', { name: 'Theme', exact: true }).last().click();
    await page
      .getByRole('option', {
        name: theme === 'high-contrast' ? 'High contrast' : theme === 'dark' ? 'Dark' : 'Light',
        exact: true,
      })
      .click();
    await expect(
      page.frameLocator('iframe[title="Agent screen preview"]').locator('.vb-theme'),
    ).toHaveAttribute('data-theme', theme);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Step', exact: true })).toBeEnabled();
    // The frame CSP forbids scripts. Audit its rendered DOM separately so Axe
    // can run its own timers without changing the production security policy.
    const frame = page.locator('iframe[title="Agent screen preview"]');
    await expect(frame).toHaveAttribute('sandbox', 'allow-same-origin');
    await expect(
      frame.contentFrame().locator('meta[http-equiv="Content-Security-Policy"]'),
    ).toHaveAttribute('content', /script-src 'none'/);
    const html = await frame
      .contentFrame()
      .locator('html')
      .evaluate(
        (element: {
          cloneNode: (deep: boolean) => unknown;
          ownerDocument: { baseURI: string };
        }) => {
          const copy = element.cloneNode(true) as {
            outerHTML: string;
            querySelectorAll: (selector: string) => {
              forEach: (
                callback: (link: {
                  href: string;
                  getAttribute: (name: string) => string | null;
                }) => void,
              ) => void;
            };
          };
          copy.querySelectorAll('link[href]').forEach((link) => {
            link.href = new URL(
              link.getAttribute('href') ?? '',
              element.ownerDocument.baseURI,
            ).href;
          });
          return copy.outerHTML;
        },
      );
    expect((await new AxeBuilder({ page }).exclude('iframe').analyze()).violations).toEqual([]);
    const auditPage = await page.context().newPage();
    try {
      await auditPage.setContent(html);
      expect((await new AxeBuilder({ page: auditPage }).analyze()).violations).toEqual([]);
    } finally {
      await auditPage.close();
    }
  });
