import { expect, test, type Page } from '@playwright/test';

const enabled = process.env['DEMO_SMOKE'] === '1';
const required = (key: string): string => {
  const value = process.env[key];
  if (enabled && !value) throw new Error(`${key} is required for clean demo acceptance`);
  return value ?? '';
};
const issuer = required('DEMO_OIDC_ISSUER');
const password = required('DEMO_SMOKE_PASSWORD');
const adminUrl = process.env['DEMO_ADMIN_URL'] ?? 'http://localhost:5175';
const designerUrl = process.env['DEMO_DESIGNER_URL'] ?? 'http://localhost:5173';
const agentUrl = process.env['DEMO_AGENT_URL'] ?? 'http://localhost:5174';
const connector = '019c0000-0000-7000-8000-000000000002';
const idp = '019c0000-0000-7000-8000-000000000014';
const campaignNames = ['Kredi Kartı Satış', 'Tarife Yükseltme', 'Tahsilat', 'Memnuniyet Anketi'];
async function signIn(page: Page, origin: string, app: string, username: string) {
  await page.goto(`${origin}/api/auth/login?tenant=verbis-demo&app=${app}&idp=${idp}`);
  await page.waitForURL(
    (url) => url.origin === new URL(issuer).origin && url.pathname.includes('/realms/verbis-demo/'),
  );
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.locator('#kc-login').click();
  await page.waitForURL(
    (url) => url.origin === new URL(origin).origin && !url.pathname.startsWith('/api/'),
  );
  const response = await page.request.get(`${origin}/api/auth/session`);
  expect(response.ok()).toBe(true);
  const session = (await response.json()) as { csrfToken: string; user: { tenantId: string } };
  expect(session.user.tenantId).toBe('019c0000-0000-7000-8000-000000000001');
  return { 'x-csrf-token': session.csrfToken };
}
test('clean demo: real SSO → four campaigns/shared screens → simulator → agent → mock → wrap-up ACK → audit chain', async ({
  browser,
}) => {
  test.skip(!enabled, 'Run the explicit isolated clean-demo installer, never against production');
  const contexts = await Promise.all(
    Array.from({ length: 3 }, () => browser.newContext({ locale: 'en-US' })),
  );
  const [adminContext, designerContext, agentContext] = contexts;
  if (!adminContext || !designerContext || !agentContext)
    throw new Error('Three isolated browser contexts are required');
  try {
    const admin = await adminContext.newPage(),
      designer = await designerContext.newPage(),
      agent = await agentContext.newPage();
    const adminHeaders = await signIn(admin, adminUrl, 'admin', 'demo-admin');
    await signIn(designer, designerUrl, 'designer', 'demo-designer');
    await designer.goto(designerUrl + '/scripts');
    await signIn(agent, agentUrl, 'agent', 'demo-agent');
    const campaigns = await admin.request.get(adminUrl + '/api/v1/campaigns');
    expect(campaigns.ok()).toBe(true);
    const items = ((await campaigns.json()) as { data: { name: string }[] }).data;
    expect(items.map((item) => item.name).sort()).toEqual([...campaignNames].sort());
    // These are the exact four seed-pinned versions; every one exposes the linked welcome page.
    for (let index = 0; index < 4; index++) {
      const version = `019c0000-0000-7000-8000-${(300 + index).toString(16).padStart(12, '0')}`;
      const screens = await designer.request.get(
        `${designerUrl}/api/v1/script-versions/${version}/screens`,
      );
      expect(screens.ok()).toBe(true);
      expect(JSON.stringify(await screens.json())).toContain('demo-intro');
    }
    for (const name of campaignNames)
      await expect(designer.getByText(name, { exact: true }).first()).toBeVisible();
    await test.info().attach('designer-four-campaigns', {
      body: await designer.screenshot(),
      contentType: 'image/png',
    });
    await expect(agent.getByText(/Waiting for an interaction|Etkileşim bekleniyor/)).toBeVisible();
    const started = await admin.request.post(
      `${adminUrl}/api/v1/simulator/connectors/${connector}/interactions`,
      {
        headers: adminHeaders,
        data: {
          channel: 'voice',
          direction: 'inbound',
          agentPlatformUserId: 'demo-agent-1',
          queue: 'demo-survey',
          attributes: { customerId: 'DEMO-CUSTOMER-004' },
          autoConnect: true,
        },
      },
    );
    expect(started.ok()).toBe(true);
    const interaction = (await started.json()) as { platformInteractionId: string };
    await expect(agent).toHaveURL(/\/s\/[0-9a-f-]{36}$/);
    const sessionId = new URL(agent.url()).pathname.split('/').at(-1);
    await expect(agent.getByText(/Shared Welcome|Ortak Karşılama/).first()).toBeVisible();
    await test
      .info()
      .attach('agent-shared-welcome', { body: await agent.screenshot(), contentType: 'image/png' });
    await agent.getByRole('checkbox').first().check();
    await agent.getByRole('button', { name: /^Start$|^Başlayalım$/ }).click();
    await agent.getByRole('button', { name: /^Start$|^Başla$/ }).click();
    await agent.getByRole('radio', { name: '10', exact: true }).check();
    await agent
      .getByRole('button', { name: /^Next$|^İleri$/ })
      .last()
      .click();
    await agent.getByRole('checkbox', { name: /Quick resolution|Hızlı çözüm/ }).check();
    await agent
      .getByRole('button', { name: /^Next$|^İleri$/ })
      .last()
      .click();
    await agent
      .getByRole('textbox', { name: /Anything you would like to add|Eklemek istedikleriniz/ })
      .fill('Synthetic clean installation smoke');
    const mock = agent.waitForResponse(
      (response) =>
        response.url().endsWith('/desktop/data-source') && response.request().method() === 'POST',
    );
    await agent.getByRole('button', { name: /^Submit$|^Gönder$/ }).click();
    expect((await mock).ok()).toBe(true);
    const wrap = await admin.request.post(
      `${adminUrl}/api/v1/simulator/connectors/${connector}/interactions/${interaction.platformInteractionId}/actions`,
      { headers: adminHeaders, data: { action: 'wrapup' } },
    );
    expect(wrap.ok()).toBe(true);
    await agent.getByRole('combobox', { name: /Disposition|Sonuç kodu/ }).click();
    await agent.getByRole('option', { name: 'SURVEY_DONE', exact: true }).click();
    await agent.getByRole('button', { name: /Submit outcome|Sonucu gönder/ }).click();
    await expect
      .poll(
        async () => {
          const response = await agent.request.get(
            `${agentUrl}/api/v1/sessions/${sessionId}/desktop`,
          );
          expect(response.ok()).toBe(true);
          return ((await response.json()) as { writeback: string }).writeback;
        },
        { timeout: 45_000 },
      )
      .toBe('success');
    const commands = await admin.request.get(
      `${adminUrl}/api/v1/simulator/connectors/${connector}`,
    );
    expect(commands.ok()).toBe(true);
    expect(
      (
        (await commands.json()) as {
          commands: { command: string; platformInteractionId: string }[];
        }
      ).commands.some(
        (command) =>
          command.command === 'setWrapUp' &&
          command.platformInteractionId === interaction.platformInteractionId,
      ),
    ).toBe(true);
    const chain = await admin.request.post(`${adminUrl}/api/v1/audit-events/verify`, {
      headers: adminHeaders,
      data: {},
    });
    expect(chain.ok()).toBe(true);
    const report = (await chain.json()) as {
      valid: boolean;
      checked: number;
      breaks: unknown[];
      truncated: boolean;
    };
    expect(report.checked).toBeGreaterThan(0);
    expect(report.valid).toBe(true);
    expect(report.breaks).toEqual([]);
    expect(report.truncated).toBe(false);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
