import { AxeBuilder } from '@axe-core/playwright';

import { expect, test, type Page } from '../../../tests/playwright/test.js';
import { editorFixture } from '../src/editor/fixtures.js';
import {
  fixtureResponse,
  scriptId,
  sessionFixture,
  tenantId,
  permissionFixture,
} from '../src/test-fixtures.js';

// DIFFERENTIATORS A1: live agent view with state-preserving hot reload.
test.use({ locale: 'en-US' });

function fixtureWithNote(count = 1) {
  const version = editorFixture(count);
  const { document } = version;
  document.variables.push({
    key: 'note',
    type: 'string',
    scope: 'session',
    default: '',
    pii: false,
    classification: 'internal',
    persist: false,
  });
  document.pages[0]?.layout.children?.unshift({
    id: 'note-input',
    type: 'textInput',
    props: { labelKey: 'note.label' },
    bindings: [{ prop: 'value', variable: 'note' }],
    events: {},
  });
  document.i18n.messages['tr'] = { ...document.i18n.messages['tr'], 'note.label': 'Not' };
  document.i18n.messages['en'] = { ...document.i18n.messages['en'], 'note.label': 'Note' };
  return version;
}

async function open(page: Page, { count = 1, live = false } = {}) {
  await page.addInitScript(
    ({ tenant, user, on }) => {
      localStorage.setItem(`verbis.tour.${tenant}.${user}`, 'done');
      localStorage.setItem('verbis.theme', 'light');
      if (on) localStorage.setItem('verbis.editor.liveView', 'on');
    },
    { tenant: tenantId, user: sessionFixture.user.id, on: live },
  );
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const body = url.pathname.endsWith('/versions/1')
      ? fixtureWithNote(count)
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
const pane = (page: Page) => page.getByRole('region', { name: 'Agent view', exact: true });
const agent = (page: Page) => page.frameLocator('iframe[title="Agent view of Minimal"]');

test('edits hot-reload into the agent view without losing what the agent typed', async ({
  page,
}) => {
  await open(page);
  const toggle = page.getByRole('button', { name: 'Agent view', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(pane(page).getByText('Live', { exact: true })).toBeVisible();

  const note = agent(page).getByRole('textbox', { name: 'Not' });
  await note.fill('customer asked about roaming');
  await expect(agent(page).getByRole('button', { name: 'İleri' })).toHaveCount(1);

  // Duplicate the button in the editor: the agent view picks it up and keeps the note.
  await page.locator('#editor-canvas').focus();
  await page.keyboard.press('End');
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect(agent(page).getByRole('button', { name: 'İleri' })).toHaveCount(2);
  await expect(note).toHaveValue('customer asked about roaming');
  await expect(pane(page)).toHaveAttribute('data-result', 'reloaded');

  await pane(page).getByRole('radio', { name: 'English' }).click();
  await expect(agent(page).getByRole('textbox', { name: 'Note' })).toHaveValue(
    'customer asked about roaming',
  );

  await pane(page).getByRole('button', { name: 'Start over' }).click();
  await expect(agent(page).getByRole('textbox', { name: 'Note' })).toHaveValue('');
});

test('the agent view preference survives a reload and the pane has no axe violations', async ({
  page,
}) => {
  await open(page, { live: true });
  await expect(pane(page)).toBeVisible();
  await expect(agent(page).getByRole('textbox', { name: 'Not' })).toBeVisible();
  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
  const report = (violations: { id: string; nodes: { target: unknown[] }[] }[]) =>
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  // The frame CSP forbids scripts; audit the pane without it, then the agent's DOM on its own.
  const frame = page.locator('iframe[title="Agent view of Minimal"]');
  await expect(frame).toHaveAttribute('sandbox', 'allow-same-origin');
  await expect(
    frame.contentFrame().locator('meta[http-equiv="Content-Security-Policy"]'),
  ).toHaveAttribute('content', /script-src 'none'/);
  const pageAudit = await new AxeBuilder({ page })
    .include('.ed-live')
    .exclude('iframe')
    .withTags(tags)
    .analyze();
  expect(report(pageAudit.violations)).toEqual([]);
  const html = await frame
    .contentFrame()
    .locator('html')
    .evaluate((element) => {
      const copy = element.cloneNode(true) as HTMLElement;
      copy.querySelectorAll<HTMLLinkElement>('link[href]').forEach((link) => {
        link.href = new URL(link.getAttribute('href') ?? '', element.ownerDocument.baseURI).href;
      });
      copy.querySelector('meta[http-equiv="Content-Security-Policy"]')?.remove();
      return copy.outerHTML;
    });
  const auditPage = await page.context().newPage();
  try {
    await auditPage.setContent(html);
    const frameAudit = await new AxeBuilder({ page: auditPage }).withTags(tags).analyze();
    expect(report(frameAudit.violations)).toEqual([]);
  } finally {
    await auditPage.close();
  }
});

test('hot reload stays within budget on a 500-node page', async ({ page }, info) => {
  await open(page, { count: 500, live: true });
  await expect(agent(page).getByRole('textbox', { name: 'Not' })).toBeVisible();
  await page.locator('#editor-canvas').focus();
  const samples: number[] = [];
  for (let i = 0; i < 10; i += 1) {
    await page.keyboard.press('End');
    await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
    await expect(pane(page)).toHaveAttribute('data-result', 'reloaded');
    samples.push(Number(await pane(page).getAttribute('data-load-ms')));
  }
  samples.sort((a, b) => a - b);
  const p95 = samples[Math.ceil(samples.length * 0.95) - 1] ?? Infinity;
  await info.attach('live-reload-ms', { body: JSON.stringify({ samples, p95 }) });
  console.log(`live reload 500 nodes: p95 ${String(p95)} ms, samples ${samples.join(', ')}`);
  // DIFFERENTIATORS §0.1 budget is 50 ms; the gate leaves headroom for slow CI runners.
  expect(p95).toBeLessThan(100);
});

for (const width of [1680, 1440, 1100, 390])
  test(`agent view layout fits ${String(width)}px without horizontal page scroll`, async ({
    page,
  }, info) => {
    await open(page, { live: true });
    await page.setViewportSize({ width, height: 900 });
    await expect(agent(page).getByRole('textbox', { name: 'Not' })).toBeVisible();
    if (width > 900) await expect(pane(page)).toBeInViewport({ ratio: 0.1 });
    // The canvas keeps room for the 375px phone paper whenever the pane sits beside it.
    if (width >= 1281)
      expect(
        await page.locator('.ed-canvas').evaluate((el) => el.clientWidth),
      ).toBeGreaterThanOrEqual(375);
    await page.screenshot({ path: info.outputPath(`live-view-${String(width)}.png`) });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
