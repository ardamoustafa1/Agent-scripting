import { AxeBuilder } from '@axe-core/playwright';

import { PageSchema, ScriptDocumentSchema } from '@verbis/script-schema';

import { expect, test } from '../../../tests/playwright/test.js';
import { editorFixture } from '../src/editor/fixtures.js';
import { editorRegistry } from '../src/editor/store.js';
import {
  fixtureResponse,
  scriptId,
  sessionFixture,
  tenantId,
  permissionFixture,
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
    async (route) => {
      const url = new URL(route.request().url());
      const body = url.pathname.endsWith('/versions/1')
        ? editorFixture()
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
    },
  );
});
test('grouping reverse-selected siblings preserves canvas order through ungroup and undo', async ({
  page,
}) => {
  await page.goto(`/scripts/${scriptId}/versions/1/edit`);
  const palette = page.locator('.ed-palette');
  await palette.locator('[data-component-type="heading"]').getByRole('button').last().click();
  const inspector = page.locator('.ed-inspector');
  const heading = await inspector.locator('code').first().innerText();
  await palette.locator('[data-component-type="text"]').getByRole('button').last().click();
  const text = await inspector.locator('code').first().innerText();
  await page.getByRole('tab', { name: 'Layers', exact: true }).click();
  await page.locator(`[data-layer-id="${text}"]`).getByRole('button').last().click();
  await page
    .locator('[data-layer-id="btn-next"]')
    .getByRole('button')
    .last()
    .click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Group', exact: true }).click();
  const group = await inspector.locator('code').first().innerText();
  const order = (id: string) =>
    page
      .locator(`.ed-runtime [data-editor-node="${id}"]`)
      .first()
      .evaluate((element) =>
        Array.from(element.querySelectorAll('[data-editor-node]')).map((child) =>
          child.getAttribute('data-editor-node'),
        ),
      );
  await expect.poll(() => order(group)).toEqual(['btn-next', text]);
  await expect.poll(() => order('home-root')).toEqual([group, 'btn-next', text, heading]);
  await page.getByRole('button', { name: 'Ungroup', exact: true }).click();
  await expect.poll(() => order('home-root')).toEqual(['btn-next', text, heading]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => order('home-root')).toEqual(['btn-next', heading, text]);
});

test('undo and redo keep the canvas content visibly laid out', async ({ page }) => {
  await page.goto(`/scripts/${scriptId}/versions/1/edit`);
  const palette = page.locator('.ed-palette');
  await palette.locator('[data-component-type="heading"]').getByRole('button').last().click();
  const headings = page.locator('.ed-runtime h2');
  await expect(headings).toHaveCount(1);
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect(headings).toHaveCount(2);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(headings).toHaveCount(1);
  await expect(headings).toBeVisible();
  await expect.poll(async () => (await headings.boundingBox())?.height ?? 0).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(headings).toHaveCount(2);
  await expect(headings.first()).toBeVisible();
  await page.getByRole('tab', { name: 'Layers', exact: true }).click();
  await page
    .locator('[data-layer-id]')
    .filter({ hasText: 'heading' })
    .last()
    .getByRole('button')
    .last()
    .click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(headings).toHaveCount(1);
  await expect(headings).toBeVisible();
});

test('initial preview handles Next without first changing language or restarting', async ({
  page,
}) => {
  await page.goto(`/scripts/${scriptId}/versions/1/edit`);
  await page
    .getByRole('navigation', { name: 'Editor', exact: true })
    .getByRole('button', { name: 'Preview / debugger', exact: true })
    .click();
  await page.frameLocator('iframe').getByRole('button', { name: 'İleri', exact: true }).click();
  await expect(page.locator('.fd-visited-edge')).not.toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save scenario', exact: true })).toBeEnabled();
});

test('reopening an edited script uses the latest server revision for autosave', async ({
  page,
}) => {
  let revision = 1;
  const matches: string[] = [];
  await page.route(
    (url) => url.pathname === `/api/v1/scripts/${scriptId}/versions/1`,
    (route) => route.fulfill({ json: { ...editorFixture(), version: revision } }),
  );
  await page.route(
    (url) => url.pathname.endsWith('/versions/1/document'),
    async (route) => {
      matches.push(route.request().headers()['if-match'] ?? '');
      revision += 1;
      await route.fulfill({ json: { version: revision } });
    },
  );
  await page.goto(`/scripts/${scriptId}/versions/1/edit`);
  await page
    .locator('.ed-palette [data-component-type="heading"]')
    .getByRole('button')
    .last()
    .click();
  await expect.poll(() => matches.length).toBe(1);
  await expect(page.locator('.ed-toolbar')).toContainText('Saved');
  await page.getByRole('link', { name: 'Scripts', exact: true }).click();
  await page.getByRole('button', { name: 'Demo script', exact: true }).click();
  revision = 7;
  await page.getByRole('button', { name: 'Screen editor', exact: true }).click();
  await page
    .locator('.ed-palette [data-component-type="heading"]')
    .getByRole('button')
    .last()
    .click();
  await expect.poll(() => matches.length).toBe(2);
  expect(matches).toEqual(['"1"', '"7"']);
});
test('rule operator changes and undo keep the visible value and saved predicate consistent', async ({
  page,
}) => {
  const fixture = editorFixture();
  fixture.document.variables.push({
    key: 'qaAmount',
    type: 'number',
    scope: 'session',
    classification: 'internal',
    pii: false,
    persist: false,
    default: 5,
  });
  fixture.document.rules.push({
    id: 'qa-range',
    description: 'QA numeric range',
    when: { fact: 'vars.qaAmount', op: 'between', value: [0, 1] },
    then: [],
  });
  await page.route(
    (url) => url.pathname === `/api/v1/scripts/${scriptId}/versions/1`,
    (route) => route.fulfill({ json: fixture }),
  );
  const saves: unknown[] = [];
  page.on('request', (request) => {
    if (request.method() === 'PUT' && request.url().endsWith('/document'))
      saves.push(request.postDataJSON());
  });
  await page.goto(`/scripts/${scriptId}/versions/1/edit`);
  await page
    .getByRole('navigation', { name: 'Editor', exact: true })
    .getByRole('button', { name: 'Rules', exact: true })
    .click();
  const value = page.getByRole('textbox', { name: 'Value', exact: true });
  await expect(value).toHaveValue('[0,1]');
  const fieldBox = await page.getByRole('combobox', { name: 'Field', exact: true }).boundingBox();
  const operatorBox = await page
    .getByRole('combobox', { name: 'Operator', exact: true })
    .boundingBox();
  if (!fieldBox || !operatorBox) throw new Error('Missing rule control rectangles');
  expect(Math.abs(fieldBox.y - operatorBox.y)).toBeLessThan(4);
  await value.fill('[10,20]');
  await value.press('Tab');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(value).toHaveValue('[0,1]');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(value).toHaveValue('[10,20]');
  await page.getByRole('combobox', { name: 'Operator', exact: true }).click();
  await page.getByRole('option', { name: 'Greater than', exact: true }).click();
  const number = page.getByRole('spinbutton', { name: 'Value', exact: true });
  await expect(number).toHaveValue('0');
  await number.fill('5');
  await expect
    .poll(() => saves.at(-1))
    .toMatchObject({
      document: {
        rules: [{ id: 'qa-range', when: { fact: 'vars.qaAmount', op: 'gt', value: 5 } }],
      },
    });
  await page.setViewportSize({ width: 390, height: 844 });
  const narrowField = await page
    .getByRole('combobox', { name: 'Field', exact: true })
    .boundingBox();
  const narrowOperator = await page
    .getByRole('combobox', { name: 'Operator', exact: true })
    .boundingBox();
  if (!narrowField || !narrowOperator) throw new Error('Missing narrow rule controls');
  expect(narrowOperator.y).toBeGreaterThan(narrowField.y + narrowField.height);
  expect(
    await page
      .locator('.rb-manager-content')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
});
test('palette drag creates a node; undo and redo restore it', async ({ page }) => {
  await page.goto(`/scripts/${scriptId}/versions/1/edit`);
  await expect(page.locator('[data-editor-node="home-root"]')).toBeAttached();
  const source = page.locator('.ed-palette-item[data-component-type="box"]').locator('.ed-grip');
  const a = await source.boundingBox(),
    b = await page.locator('.ed-paper').boundingBox();
  if (!a || !b) throw new Error('Missing drag rectangles');
  const before = await page.locator('[data-editor-node]').count();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 60, b.y + 120, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('[data-editor-node]')).toHaveCount(before + 1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('[data-editor-node]')).toHaveCount(before);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.locator('[data-editor-node]')).toHaveCount(before + 1);
});
for (const theme of ['light', 'dark', 'high-contrast'])
  test(`editor ${theme} keyboard and axe`, async ({ page }) => {
    await page.addInitScript((value) => {
      localStorage.setItem('verbis.theme', value);
    }, theme);
    await page.goto(`/scripts/${scriptId}/versions/1/edit`);
    await page.getByRole('tab', { name: 'Layers', exact: true }).click();
    await page.getByRole('treeitem').first().getByRole('button').last().click();
    await page.keyboard.press('Escape');
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

test('virtual layer drag reorders siblings in one undo step', async ({ page }) => {
  await page.route('**/api/v1/scripts/*/versions/1', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(editorFixture(3)),
    }),
  );
  await page.goto(`/scripts/${scriptId}/versions/1/edit`);
  await page.getByRole('tab', { name: 'Layers', exact: true }).click();
  const source = await page.locator('[data-layer-id="fixture-1"] .ed-grip').first().boundingBox();
  const target = await page.locator('[data-layer-id="fixture-0"]').boundingBox();
  if (!source || !target) throw new Error('Missing layer bounds');
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
  await page.mouse.up();
  const ids = () =>
    page
      .locator('[data-layer-id]')
      .evaluateAll((elements: readonly { getAttribute: (name: string) => string | null }[]) =>
        elements.map((el) => el.getAttribute('data-layer-id')),
      );
  await expect.poll(ids).toEqual(['home-root', 'btn-next', 'fixture-1', 'fixture-0']);
  // dnd-kit's pointer sensor suppresses release clicks for 50 ms after a drag.
  // A complete 60 ms press/release exercises the toolbar after that gesture ends.
  await page.getByRole('button', { name: 'Undo', exact: true }).click({ delay: 60 });
  await expect.poll(ids).toEqual(['home-root', 'btn-next', 'fixture-0', 'fixture-1']);
});
test('draft writes carry CSRF, optimistic version and linked screen pins', async ({ page }) => {
  const fixture = {
    ...editorFixture(),
    screens: [
      {
        sharedScreenId: '01928f3a-0000-7000-8000-000000000010',
        versionNumber: 3,
        mode: 'linked',
        pageIds: ['linked-home'],
      },
    ],
  };
  fixture.document.pages.push(
    PageSchema.parse({
      id: 'linked-home',
      name: 'Shared fixture',
      layout: { id: 'linked-root', type: 'box' },
    }),
  );
  await page.route('**/api/v1/scripts/*/versions/1', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) }),
  );
  await page.goto(`/scripts/${scriptId}/versions/1/edit`);
  await page.getByRole('tab', { name: 'Layers', exact: true }).click();
  await page.locator('[data-layer-id="btn-next"]').getByRole('button').last().click();
  const saved = page.waitForRequest(
    (request) => request.method() === 'PUT' && request.url().endsWith('/document'),
  );
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
  const request = await saved;
  expect(request.headers()['x-csrf-token']).toBe(sessionFixture.csrfToken);
  expect(request.headers()['if-match']).toBe('"1"');
  expect(request.postDataJSON()).toMatchObject({
    screens: [
      { sharedScreenId: fixture.screens[0]?.sharedScreenId, versionNumber: 3, mode: 'linked' },
    ],
    document: { schemaVersion: '1.1.0' },
  });
});

for (const theme of ['light', 'dark']) {
  test(`@visual designer-web main screen ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.clock.setFixedTime(new Date('2026-10-03T09:00:00Z'));
    await page.addInitScript((value) => {
      localStorage.setItem('verbis.theme', value);
    }, theme);
    await page.goto(`/scripts/${scriptId}/versions/1/edit`);
    await expect(page.locator('[data-editor-node="home-root"]')).toBeAttached();
    await page.evaluate('document.fonts.ready.then(() => undefined)');
    await expect(page).toHaveScreenshot(`designer-web-${theme}.png`, { fullPage: true });
  });
}

test('creates a script from scratch, drags a component, builds decision/service flow and a rule', async ({
  page,
}) => {
  const fixture = editorFixture();
  // A tenant service definition is configured independently in integrations.spec.ts.
  fixture.document.dataSources.push({
    id: 'lookup',
    ref: 'tenant-datasource:customer-lookup',
    version: 1,
    inputs: {},
    outputs: {},
    policy: { trigger: 'manual', timeoutMs: 5000, cacheTtlSec: 0 },
  });
  const sourceId = '01928f3a-0000-7000-8000-000000000011';
  const sourceFixture = structuredClone(fixture);
  let draftCreated = false;
  let created = false,
    revision = 1;
  let saved: unknown;
  await page.route('**/api/v1/scripts**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (path === '/api/v1/scripts' && request.method() === 'POST') {
      expect(request.headers()['x-csrf-token']).toBe(sessionFixture.csrfToken);
      expect(request.headers()['idempotency-key']).toBeDefined();
      expect(request.postDataJSON()).toMatchObject({ name: 'Synthetic new script' });
      created = true;
      return route.fulfill({
        status: 201,
        json: { id: scriptId, name: 'Synthetic new script', tags: [] },
      });
    }
    if (path === '/api/v1/scripts' && !created)
      return route.fulfill({ json: { data: [], page: { nextCursor: null } } });
    if (path === `/api/v1/scripts/${scriptId}` && request.method() === 'GET')
      return route.fulfill({ json: { id: scriptId, name: 'Synthetic new script', tags: [] } });
    if (path === `/api/v1/scripts/${sourceId}/versions/1`)
      return route.fulfill({ json: sourceFixture });
    if (path === `/api/v1/scripts/${scriptId}/versions` && request.method() === 'POST') {
      const body = request.postDataJSON() as { document: unknown; screens: unknown[] };
      expect(request.headers()['x-csrf-token']).toBe(sessionFixture.csrfToken);
      expect(request.headers()['idempotency-key']).toBeDefined();
      fixture.document = ScriptDocumentSchema.parse(body.document);
      expect(fixture.document.dataSources).toEqual([]);
      draftCreated = true;
      return route.fulfill({ status: 201, json: { number: 1, version: 1 } });
    }
    if (path === `/api/v1/scripts/${scriptId}/versions` && !draftCreated)
      return route.fulfill({ json: { data: [], page: { nextCursor: null } } });
    if (path.endsWith('/versions/1')) return route.fulfill({ json: fixture });
    if (path.endsWith('/document') && request.method() === 'PUT') {
      expect(request.headers()['x-csrf-token']).toBe(sessionFixture.csrfToken);
      expect(request.headers()['if-match']).toBe(`"${revision}"`);
      saved = request.postDataJSON();
      return route.fulfill({ json: { version: ++revision } });
    }
    return route.fallback();
  });
  await page.goto('/scripts');
  await page.getByRole('button', { name: 'New script', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('Synthetic new script');
  await dialog
    .getByRole('combobox', { name: 'Campaign', exact: true })
    .selectOption({ label: 'Demo campaign' });
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/scripts/${scriptId}$`));
  await page.getByRole('button', { name: 'Create first draft', exact: true }).click();
  await expect(page.locator('[data-editor-node="home-root"]')).toBeAttached();
  const source = page.locator('.ed-palette-item[data-component-type="box"]').locator('.ed-grip');
  const from = await source.boundingBox(),
    to = await page.locator('.ed-paper').boundingBox();
  if (!from || !to) throw new Error('Missing drag targets');
  const before = await page.locator('[data-editor-node]').count();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 60, to.y + 120, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('[data-editor-node]')).toHaveCount(before + 1);
  const mode = async (name: string) => {
    await page.getByRole('combobox', { name: 'Editor', exact: true }).click();
    await page.getByRole('option', { name, exact: true }).click();
  };
  await mode('Rules');
  await page.getByRole('button', { name: 'Add rule', exact: true }).click();
  await page.getByLabel('Description', { exact: true }).fill('Synthetic voice eligibility');
  await mode('Flow');
  await page.getByRole('button', { name: 'Import script as subflow', exact: true }).click();
  const importDialog = page.getByRole('dialog');
  await importDialog.getByLabel('Source script ID', { exact: true }).fill(sourceId);
  await importDialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(importDialog).not.toBeVisible();
  await page.getByRole('combobox', { name: 'Flow designer', exact: true }).click();
  await page.getByRole('option', { name: 'main', exact: true }).click();
  await page.getByRole('button', { name: 'Decision', exact: true }).click();
  await page.getByRole('button', { name: 'Auto layout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Auto layout', exact: true })).toBeEnabled();
  const decision = page.locator('.react-flow__node-verbis').filter({ hasText: 'Decision' });
  await decision.click();
  const decisionId = await decision.getAttribute('data-id');
  expect(decisionId).toBeTruthy();
  const connect = async (target: string, port: string) => {
    await page.getByRole('combobox', { name: 'Target node', exact: true }).click();
    await page.getByRole('option', { name: target, exact: true }).click();
    await page.getByRole('combobox', { name: 'Condition', exact: true }).click();
    await page.getByRole('option', { name: port, exact: true }).click();
    await page.getByRole('button', { name: 'Connect nodes', exact: true }).click();
  };
  await connect('n-home', 'Condition');
  await connect('n-end', 'Else');
  await page.getByRole('button', { name: 'Data source', exact: true }).click();
  await page.getByRole('button', { name: 'Auto layout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Auto layout', exact: true })).toBeEnabled();
  const service = page.locator('.react-flow__node-verbis').filter({ hasText: 'Data source' });
  await service.click();
  const serviceId = await service.getAttribute('data-id');
  expect(serviceId).toBeTruthy();
  await connect(decisionId!, 'Success');
  await connect('n-end', 'Error');
  await page.getByRole('button', { name: 'Set as entry', exact: true }).click();
  await expect
    .poll(() => saved)
    .toMatchObject({
      document: {
        rules: [{ description: 'Synthetic voice eligibility' }],
        dataSources: [{ ref: 'tenant-datasource:customer-lookup' }],
        flow: {
          start: serviceId,
          edges: expect.arrayContaining([
            expect.objectContaining({ from: decisionId, default: true, to: 'n-end' }),
            expect.objectContaining({ from: serviceId, port: 'success', to: decisionId }),
            expect.objectContaining({ from: serviceId, port: 'error', to: 'n-end' }),
          ]),
          nodes: expect.arrayContaining([
            expect.objectContaining({ type: 'decision' }),
            expect.objectContaining({ type: 'dataSource' }),
          ]),
        },
      },
    });
});

test('finds a component on a different page and focuses its inspector', async ({ page }) => {
  await page.goto(`/scripts/${scriptId}/versions/1/edit`);
  await expect(page.locator('[data-editor-node="btn-next"]')).toBeAttached();
  await page.locator('.ed-left').getByRole('tab', { name: 'Pages', exact: true }).click();
  await page.getByRole('button', { name: 'Add page', exact: true }).click();
  await expect(page.locator('[data-editor-node="btn-next"]')).toHaveCount(0);
  await page.locator('.ed-left').getByRole('tab', { name: 'Layers', exact: true }).click();
  await page.getByRole('textbox', { name: 'Find component across all pages' }).fill('btn-next');
  await page
    .getByRole('region', { name: 'Component results' })
    .getByRole('button', { name: /btn-next/ })
    .click();
  await expect(page.locator('[data-editor-node="btn-next"]')).toBeAttached();
  await expect(page.locator('.ed-inspector')).toContainText('btn-next');
  await expect(page.locator('.ed-selection')).toBeVisible();
});

for (const definition of editorRegistry.list().filter((item) => item.designerMeta.draggable)) {
  test(`palette ${definition.type}: insert, five inspector tabs, undo and redo`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`/scripts/${scriptId}/versions/1/edit`);
    await expect(page.locator('[data-editor-node="home-root"]')).toBeAttached();
    await page
      .locator(`[data-component-type="${definition.type}"]`)
      .getByRole('button')
      .last()
      .click();
    const inspector = page.locator('.ed-inspector');
    await expect(inspector).toBeVisible();
    const id = await inspector.locator('code').first().innerText();
    if (['explicitConsent', 'repeater'].includes(definition.type)) {
      await expect(
        page.getByRole('status').filter({ hasText: '0 validation errors' }),
      ).toBeVisible();
      await expect(page.locator('.ed-runtime')).not.toContainText(
        'This component could not be displayed',
      );
      await expect(page.locator('[data-editor-node="btn-next"]')).toBeAttached();
    }
    for (const tab of ['Properties', 'Style', 'Binding', 'Events', 'Rules']) {
      await inspector.getByRole('tab', { name: tab, exact: true }).click();
      await expect(inspector.getByRole('tab', { name: tab, exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    }
    await page.getByRole('tab', { name: 'Layers', exact: true }).click();
    await expect(page.locator(`[data-layer-id="${id}"]`)).toBeVisible();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.locator(`[data-layer-id="${id}"]`)).toHaveCount(0);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(page.locator(`[data-layer-id="${id}"]`)).toBeVisible();
    expect(errors).toEqual([]);
  });
}
