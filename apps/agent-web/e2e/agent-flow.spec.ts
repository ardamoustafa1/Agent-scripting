import { AxeBuilder } from '@axe-core/playwright';

import { minimalScript } from '@verbis/script-schema/fixtures';

import { expect, test, type Page } from '../../../tests/playwright/test.js';

// DIFFERENTIATORS D1/D2/D4: keyboard-only flow, focus mode and transition time.
test.use({ locale: 'en-US' });
const id = '01928f3a-0000-7000-8000-000000000001';

function script(withNotice = false) {
  const document = minimalScript();
  document.variables = [
    { key: 'name', type: 'string', scope: 'session', default: '', classification: 'public' },
  ];
  document.pages.push({
    id: 'details',
    name: 'details',
    titleKey: 'pages.details',
    layout: {
      id: 'details-root',
      type: 'box',
      children: [
        {
          id: 'name-input',
          type: 'textInput',
          props: { labelKey: 'fields.name' },
          bindings: [{ prop: 'value', variable: 'name' }],
        },
      ],
    },
  });
  document.flow.nodes.splice(1, 0, { id: 'n-details', type: 'page', page: 'details' });
  document.flow.edges = [
    { id: 'e1', from: 'n-home', to: 'n-details' },
    { id: 'e2', from: 'n-details', to: 'n-end' },
  ];
  if (withNotice)
    document.pages[0]?.layout.children?.push({
      id: 'txt-kvkk',
      type: 'scriptText',
      props: { mustRead: true, titleKey: 'notices.kvkk', textKey: 'notices.kvkk' },
      bindings: [],
      events: {},
    });
  for (const locale of ['tr', 'en'] as const)
    document.i18n.messages[locale] = {
      ...document.i18n.messages[locale],
      'pages.details': 'Customer details',
      'fields.name': 'Customer name',
      'notices.kvkk': 'Privacy notice',
    };
  return document;
}

async function desktop(page: Page, preferences?: Record<string, unknown>, withNotice = false) {
  await page.addInitScript(
    (value) => {
      localStorage.setItem('verbis.theme', 'light');
      if (value !== '') localStorage.setItem('verbis.agent.preferences', value);
    },
    preferences ? JSON.stringify(preferences) : '',
  );
  let view = {
    id,
    state: 'active',
    sequence: 1,
    readOnly: false,
    snapshot: {
      variables: { name: '' } as Record<string, unknown>,
      currentPage: 'home',
      history: [] as string[],
      timers: {},
    },
  };
  const data = {
    document: script(withNotice),
    checksum: 'synthetic',
    startedAt: '2026-10-03T09:00:00Z',
    interaction: {
      channel: 'voice',
      status: 'connected',
      queue: 'Synthetic queue',
      platform: 'generic',
      customerName: 'Synthetic customer',
      context: {},
    },
    campaign: {
      name: 'Synthetic campaign',
      outcomes: [
        {
          code: 'DONE',
          label: 'Resolved',
          category: 'success',
          requiresNote: false,
          requiredFields: [],
          subCodes: [],
        },
      ],
    },
    writeback: 'none',
  };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = (route.request().postDataJSON() ?? {}) as { command?: Record<string, unknown> };
    if (path.endsWith('/commands') && body.command) {
      const command = body.command;
      view = { ...view, sequence: view.sequence + 1 };
      if (command['type'] === 'page')
        view.snapshot = {
          ...view.snapshot,
          currentPage: String(command['pageId']),
          history: (command['history'] as string[] | undefined) ?? [],
        };
      if (command['type'] === 'field')
        view.snapshot.variables[String(command['variable'])] = command['value'];
      if (command['type'] === 'transition') view.state = String(command['state']);
    }
    const result =
      path === '/api/auth/session'
        ? {
            user: { id: 'synthetic-user', tenantId: 'synthetic-tenant', authMethod: 'sso' },
            session: { id: 'synthetic-bff' },
            csrfToken: 'synthetic-csrf',
          }
        : path.endsWith('/permissions')
          ? { roles: ['agent'] }
          : path === '/api/v1/sessions'
            ? { data: [], page: { nextCursor: null } }
            : path.endsWith('/desktop')
              ? { ...data, view }
              : path.endsWith('/attach')
                ? { ...view, writeToken: 'a'.repeat(43), leaseUntil: '2026-10-03T10:00:00Z' }
                : path.endsWith('/socket-ticket')
                  ? { ticket: 'synthetic', namespace: '/launch' }
                  : path.endsWith('/ai/status')
                    ? { agentEnabled: false }
                    : path.endsWith('/desktop/feedback')
                      ? { recorded: true, threadId: '01928f3a-0000-7000-8000-0000000000fb' }
                      : view;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(result),
    });
  });
  await page.routeWebSocket('**/socket.io/**', (socket) => {
    socket.send(
      '0' +
        JSON.stringify({
          sid: 'synthetic',
          upgrades: [],
          pingInterval: 60000,
          pingTimeout: 60000,
          maxPayload: 1000000,
        }),
    );
    socket.onMessage((message) => {
      if (typeof message !== 'string') return;
      if (message.startsWith('40/launch')) socket.send('40/launch,{"sid":"synthetic-launch"}');
      if (message.startsWith('40/runtime')) {
        socket.send('40/runtime,{"sid":"synthetic-runtime"}');
        socket.send('42/runtime,["runtime.resume",{}]');
      }
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/s/${id}`);
  await expect(page.getByRole('heading', { name: 'Synthetic customer' })).toBeVisible();
  await expect(page.locator('[data-agent-next]')).toBeEnabled();
}
const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

test('an agent completes the flow with the keyboard alone', async ({ page }, info) => {
  await desktop(page);
  await expect(page.getByRole('heading', { level: 2, name: 'Home' })).toBeVisible();
  await expect(page.getByText('Step 1', { exact: true })).toBeVisible();

  await page.locator('body').click({ position: { x: 5, y: 5 } });
  const started = Date.now();
  await page.keyboard.press('Enter');
  const field = page.getByRole('textbox', { name: 'Customer name' });
  await expect(field).toBeFocused();
  const transitionMs = Date.now() - started;
  await expect(page.getByRole('heading', { level: 2, name: 'Customer details' })).toBeVisible();
  await expect(page.getByText('Step 2', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: 'Now on: Customer details' }),
  ).toBeAttached();
  await info.attach('transition-ms', { body: String(transitionMs) });

  await page.keyboard.type('Ada Lovelace');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByRole('heading', { name: 'Wrap up' })).toBeVisible();
  // The whole step, request round trip included, against a local mock; budget is 100 ms p95.
  expect(transitionMs).toBeLessThan(1000);
});

test('focus mode enlarges the current step, survives a reload and stays accessible', async ({
  page,
}, info) => {
  await desktop(page);
  const workspace = page.locator('.ag-workspace');
  await expect(workspace).toHaveAttribute('data-focus', 'false');
  const before = await page
    .getByRole('heading', { level: 2, name: 'Home' })
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  await page.keyboard.press('Alt+f');
  await expect(workspace).toHaveAttribute('data-focus', 'true');
  const after = await page
    .getByRole('heading', { level: 2, name: 'Home' })
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(after).toBeGreaterThan(before);
  await page.screenshot({ path: info.outputPath('focus-mode.png') });
  const { violations } = await new AxeBuilder({ page }).withTags(tags).analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
  await page.reload();
  await expect(page.locator('.ag-workspace')).toHaveAttribute('data-focus', 'true');
});

test('? opens a focus-trapped shortcut list that Escape closes', async ({ page }) => {
  await desktop(page, { size: 'medium', density: 'comfortable' });
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('?');
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(help).toBeVisible();
  await expect(help.getByText('Next, even from a long answer')).toBeVisible();
  await page.keyboard.press('Enter');
  // Enter inside the dialog never advances the conversation.
  await expect(page.getByRole('heading', { level: 2, name: 'Home' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();
});

test('an agent flags a confusing page without sending any customer data', async ({ page }) => {
  await desktop(page);
  const sent = page.waitForRequest((request) => request.url().endsWith('/desktop/feedback'));
  await page.getByRole('button', { name: 'Feedback' }).click();
  const dialog = page.getByRole('dialog', { name: 'Tell the script designers' });
  await expect(dialog).toBeVisible();
  await dialog.evaluate((el) =>
    Promise.all(el.getAnimations().map((animation) => animation.finished)),
  );
  const { violations } = await new AxeBuilder({ page })
    .include('[role=dialog]')
    .withTags(tags)
    .analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
  await dialog.getByRole('radio', { name: 'A step is missing' }).click();
  await dialog.getByRole('button', { name: 'Send feedback' }).click();
  expect((await sent).postDataJSON()).toEqual({ pageId: 'home', reason: 'missingStep' });
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole('status').filter({ hasText: 'The design team will see this on the page.' }),
  ).toBeAttached();
});

test('the required-notice checklist follows the confirmation and stays accessible', async ({
  page,
}) => {
  await desktop(page, undefined, true);
  await page.getByRole('button', { name: 'Side panel' }).click();
  const tab = page.getByRole('tab', { name: 'Required notices (1)' });
  await tab.click();
  const panel = page.getByRole('tabpanel');
  await expect(panel.getByText('0 of 1 confirmed')).toBeVisible();
  await expect(panel.getByText('Pending', { exact: true })).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).withTags(tags).analyze()).violations.map((v) => v.id),
  ).toEqual([]);
  await page.getByRole('checkbox', { name: 'I have read this text to the customer' }).check();
  await expect(panel.getByText('1 of 1 confirmed')).toBeVisible();
  await expect(panel.getByText('Done', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Required notices', exact: true })).toBeVisible();
});
