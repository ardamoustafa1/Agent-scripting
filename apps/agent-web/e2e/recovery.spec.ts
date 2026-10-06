import { AxeBuilder } from '@axe-core/playwright';

import { minimalScript } from '@verbis/script-schema/fixtures';

import { expect, test, type Page } from '../../../tests/playwright/test.js';

const ids = ['01928f3a-0000-7000-8000-000000000001', '01928f3a-0000-7000-8000-000000000002'];
async function fixture(
  page: Page,
  failure?: number | 'script',
  policy?: 'block' | 'continue' | 'manual',
) {
  const attaches: string[] = [];
  const states: Record<
    string,
    { state: string; sequence: number; name: string; page: string | null }
  > = {};
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const id = ids.find((id) => path.includes(id)) ?? ids[0]!;
    const second = id === ids[1];
    const document = minimalScript();
    if (failure === 'script')
      document.pages[0]!.layout.props = { invalidSecret: 'never-show-this' };
    const remote = (states[id] ??= {
      state: policy ? 'launching' : 'wrapup',
      sequence: 1,
      name: '',
      page: policy ? null : 'home',
    });
    if (policy) {
      document.variables = [
        { key: 'name', type: 'string', scope: 'session', default: '', classification: 'public' },
      ];
      document.dataSources = [
        {
          id: 'lookup',
          ref: 'tenant-datasource:lookup',
          version: 1,
          outputs: { answer: { path: '$.answer', variable: 'name' } },
          policy: { trigger: 'onEnter', onFailure: policy },
        },
      ];
    }
    const view = () => ({
      id,
      state: remote.state,
      sequence: remote.sequence,
      readOnly: true,
      snapshot: {
        variables: policy ? { name: remote.name } : {},
        currentPage: remote.page,
        history: [],
        timers: {},
      },
    });
    const desktop = {
      view: view(),
      document,
      checksum: 'test',
      startedAt: second ? '2026-10-06T10:01:00Z' : '2026-10-06T10:00:00Z',
      interaction: {
        channel: second ? 'chat' : 'voice',
        status: 'connected',
        platform: 'generic',
        queue: null,
        customerName: second ? 'Bora' : 'Ayşe',
        context: {},
      },
      campaign: { name: 'Test', outcomes: [] },
      writeback: 'none',
    };
    if (typeof failure === 'number' && path.endsWith('/desktop')) {
      await route.fulfill({
        status: failure,
        json: {
          code: 'VERBIS_AUTHZ_FORBIDDEN',
          correlationId: 'support-browser-42',
          detail: 'never-show-this',
        },
      });
      return;
    }
    let result: unknown = {};
    if (path.endsWith('/auth/session'))
      result = {
        user: { id: ids[0], tenantId: ids[1], authMethod: 'sso' },
        session: { id: ids[1] },
        csrfToken: 'test',
      };
    else if (path.endsWith('/permissions')) result = { roles: ['agent'] };
    else if (path.endsWith('/tenant')) result = { settings: {} };
    else if (path.endsWith('/sessions'))
      result = {
        data: ids.map((id, index) => ({
          id,
          userId: ids[0],
          state: 'wrapup',
          startedAt: `2026-10-06T10:0${index}:00Z`,
        })),
        page: { nextCursor: null },
      };
    else if (path.endsWith('/desktop')) result = desktop;
    else if (path.endsWith('/attach') || path.endsWith('/takeover')) {
      attaches.push(path);
      result = {
        ...view(),
        readOnly: false,
        writeToken: 'a'.repeat(43),
        leaseUntil: new Date(Date.now() + 60000).toISOString(),
      };
    } else if (path.endsWith('/socket-ticket')) result = { ticket: 'test', namespace: '/launch' };
    else if (path.endsWith('/state')) result = view();
    else if (path.endsWith('/failure')) result = { recorded: true };
    else if (path.endsWith('/data-source')) {
      await route.fulfill({
        status: 503,
        json: { code: 'VERBIS_INTEGRATION_UNAVAILABLE', correlationId: 'support-datasource-42' },
      });
      return;
    } else if (path.endsWith('/data-source-recovery')) result = view();
    else if (path.endsWith('/commands')) {
      const payload = route.request().postDataJSON() as {
        command: { type: string; state?: string; value?: string; pageId?: string };
      };
      remote.sequence++;
      if (payload.command.type === 'transition') remote.state = payload.command.state!;
      if (payload.command.type === 'field') remote.name = payload.command.value!;
      if (payload.command.type === 'page') remote.page = payload.command.pageId!;
      result = view();
    }
    await route.fulfill({ status: 200, json: result });
  });
  await page.routeWebSocket('**/socket.io/**', (socket) => {
    socket.send(
      '0' +
        JSON.stringify({
          sid: 'test',
          upgrades: [],
          pingInterval: 60000,
          pingTimeout: 60000,
          maxPayload: 1000000,
        }),
    );
    socket.onMessage((message) => {
      if (typeof message !== 'string') return;
      if (message.startsWith('40/launch')) socket.send('40/launch,{"sid":"test"}');
      if (message.startsWith('40/runtime')) {
        socket.send('40/runtime,{"sid":"test"}');
        socket.send('42/runtime,["runtime.resume",{}]');
      }
    });
  });
  await page.goto(`/s/${ids[0]}`);
  return attaches;
}
for (const width of [390, 1440]) {
  test(`multiple sessions: labeled tabs, inert panels, deferred attach and keyboard/axe at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const attaches = await fixture(page);
    const voice = page.getByRole('tab', { name: /Voice · Ayşe/ });
    const chat = page.getByRole('tab', { name: /Chat · Bora/ });
    await expect(voice).toBeVisible();
    await expect(chat).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toHaveCount(1);
    expect(attaches.filter((path) => path.endsWith('/attach'))).toHaveLength(1);
    await voice.focus();
    await page.keyboard.press('ArrowRight');
    await expect(chat).toBeFocused();
    await expect(chat).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toHaveCount(1);
    await expect(page.locator(`#interaction-${ids[0]}`)).toHaveAttribute('inert', '');
    await expect(page.locator(`#interaction-${ids[0]}`)).toBeHidden();
    expect(attaches.filter((path) => path.endsWith('/attach'))).toHaveLength(2);
    await page.keyboard.press('Home');
    await expect(voice).toBeFocused();
    await expect(voice).toHaveAttribute('aria-selected', 'true');
    expect(attaches.filter((path) => path.endsWith('/attach'))).toHaveLength(2);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}
for (const failure of [403, 'script'] as const) {
  test(`safe ${failure} failure includes support code and passes axe`, async ({ page }) => {
    await fixture(page, failure);
    await expect(page.getByRole('button', { name: 'Copy support code' })).toBeVisible();
    await expect(page.getByText('never-show-this')).toHaveCount(0);
    if (failure === 403) await expect(page.getByText('support-browser-42')).toBeVisible();
    else await expect(page.getByText(/The script could not run/)).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}

for (const policy of ['block', 'continue', 'manual'] as const) {
  test(`on-enter datasource ${policy} recovery preserves the session and author policy`, async ({
    page,
  }) => {
    await fixture(page, undefined, policy);
    await expect(page.getByRole('status').getByText('support-datasource-42')).toBeVisible();
    await expect(page.locator('[data-agent-next]')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
    if (policy === 'continue')
      await page.getByRole('button', { name: 'Continue without data' }).click();
    if (policy === 'manual') {
      await page.getByRole('textbox', { name: 'name', exact: true }).fill('Operator result');
      await page.getByRole('button', { name: 'Confirm manual data' }).click();
    }
    if (policy === 'block') {
      await expect(page.getByRole('button', { name: 'Continue without data' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Confirm manual data' })).toHaveCount(0);
      await page.getByRole('button', { name: 'Try again', exact: true }).click();
      await expect(page.getByRole('status').getByText('support-datasource-42')).toBeVisible();
    } else {
      await expect(page.getByText('support-datasource-42')).toHaveCount(0);
      await expect(page.locator('[data-agent-next]')).toBeEnabled();
      await page.locator('[data-agent-next]').click();
      await expect(page.getByRole('heading', { name: /^Wrap.?up$/i })).toBeVisible();
    }
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}
