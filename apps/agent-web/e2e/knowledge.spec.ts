import { AxeBuilder } from '@axe-core/playwright';

import { minimalScript } from '@verbis/script-schema/fixtures';

import { expect, test, type Page } from '../../../tests/playwright/test.js';

// ADR-0057: the knowledge base beside the script, in the script and from a transcript trigger.
test.use({ locale: 'en-US' });
const id = '01928f3a-0000-7000-8000-000000000001';
const refund = {
  key: 'refund-policy',
  title: 'Refund policy',
  body: 'Refunds are made within 14 days.\n\n## Steps\n1. Verify the customer\n2. Record the request',
  tags: ['refund'],
  locale: 'en',
  updatedAt: '2026-10-22T09:00:00.000Z',
};

async function desktop(page: Page) {
  const document = minimalScript();
  const home = document.pages[0];
  if (!home) throw new Error('fixture page');
  home.layout.children = [
    ...(home.layout.children ?? []),
    { id: 'kb-panel', type: 'knowledgePanel', props: { articles: ['refund-policy'] } },
  ];
  const view = {
    id,
    state: 'active',
    sequence: 1,
    readOnly: false,
    snapshot: { variables: {}, currentPage: 'home', history: [], timers: {} },
  };
  const data = {
    document,
    view,
    checksum: 'synthetic',
    startedAt: '2026-10-22T09:00:00Z',
    interaction: {
      channel: 'voice',
      status: 'connected',
      queue: 'Synthetic queue',
      platform: 'generic',
      customerName: 'Synthetic customer',
      context: {},
    },
    campaign: { name: 'Synthetic campaign', outcomes: [] },
    writeback: 'none',
    transcript: { enabled: true },
    prompts: [
      {
        triggerId: 'refund-intent',
        segmentId: 's1',
        speaker: 'customer',
        firedAt: '2026-10-22T09:00:05Z',
        actions: [{ type: 'suggestArticle', articleKey: 'refund-policy' }],
      },
    ],
  };
  const sent: { path: string; method: string; body: unknown }[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (request.method() !== 'GET')
      sent.push({ path, method: request.method(), body: request.postDataJSON() as unknown });
    if (path.includes('/desktop/prompts/')) data.prompts = [];
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
              ? data
              : path.endsWith('/desktop/transcript')
                ? {
                    enabled: true,
                    lines: [
                      {
                        segmentId: 's1',
                        speaker: 'customer',
                        text: 'How long does a refund take?',
                        final: true,
                        at: '2026-10-22T09:00:04Z',
                      },
                    ],
                  }
                : path.endsWith('/desktop/knowledge/search')
                  ? {
                      results: [
                        {
                          key: 'refund-policy',
                          title: 'Refund policy',
                          snippet: 'Refunds are made within 14 days.',
                          tags: ['refund'],
                          locale: 'en',
                          status: 'published',
                          updatedAt: refund.updatedAt,
                        },
                      ],
                    }
                  : path.endsWith('/desktop/knowledge/refund-policy')
                    ? refund
                    : path.endsWith('/v1/ai/status')
                      ? { enabled: true, agentEnabled: true }
                      : path.endsWith('/v1/ai/suggestions')
                        ? {
                            callId: '01928f3a-0000-7000-8000-0000000000aa',
                            task: 'answer',
                            requiresHumanApproval: true,
                            value: {
                              answer: 'Refunds are made within 14 days.',
                              articleKeys: ['refund-policy'],
                              reason: 'Stated in the article',
                            },
                            inputTokens: 1,
                            outputTokens: 1,
                            maskedCount: 0,
                          }
                        : path.endsWith('/attach')
                          ? {
                              ...view,
                              writeToken: 'a'.repeat(43),
                              leaseUntil: '2099-10-03T10:00:00Z',
                            }
                          : path.endsWith('/state') ||
                              path.includes('/desktop/prompts/') ||
                              path.endsWith('/commands')
                            ? view
                            : path.endsWith('/socket-ticket')
                              ? { ticket: 'synthetic', namespace: '/launch' }
                              : null;
    await route.fulfill({
      status: result ? 200 : 404,
      contentType: 'application/json',
      body: JSON.stringify(result ?? {}),
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
  await page.goto(`/s/${id}`);
  await expect(page.getByRole('heading', { name: 'Synthetic customer' })).toBeVisible();
  return { sent };
}

test('Alt+K searches the knowledge base and reads an article without leaving the step', async ({
  page,
}) => {
  const { sent } = await desktop(page);
  await page.getByRole('heading', { name: 'Synthetic customer' }).click();
  await page.keyboard.press('Alt+KeyK');
  const box = page
    .getByRole('complementary')
    .getByRole('searchbox', { name: 'Search the knowledge base' });
  await expect(box).toBeFocused();
  await box.fill('refund');
  await page
    .getByRole('complementary')
    .getByRole('button', { name: /Refund policy/ })
    .click();
  await expect(
    page.getByRole('complementary').getByRole('heading', { level: 3, name: 'Refund policy' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Back to results' }).click();
  await expect(box).toHaveValue('refund');
  expect(sent.find((r) => r.path.endsWith('/knowledge/search'))).toEqual({
    path: `/api/v1/sessions/${id}/desktop/knowledge/search`,
    method: 'POST',
    body: { q: 'refund', limit: 10 },
  });
});

test('the in-script panel opens pinned articles in place; Enter in it never moves on', async ({
  page,
}) => {
  const { sent } = await desktop(page);
  const panel = page.locator('.ag-runtime').getByRole('region', { name: 'Knowledge base' });
  await panel.getByRole('button', { name: 'Refund policy' }).click();
  await expect(panel.getByText('Refunds are made within 14 days.')).toBeVisible();
  await panel.getByRole('searchbox').fill('refund');
  await panel.getByRole('searchbox').press('Enter');
  await expect(panel.getByRole('button', { name: /Refund policy Refunds/ })).toBeVisible();
  expect(sent.some((r) => r.path.endsWith('/commands'))).toBe(false);
});

test('a transcript trigger offers the article and opens it in the side panel', async ({ page }) => {
  const { sent } = await desktop(page);
  const prompts = page.getByRole('region', { name: 'Suggestions from the conversation' });
  await expect(prompts.getByText('Related article: “Refund policy”.')).toBeVisible();
  await prompts.getByRole('button', { name: 'Open the article' }).click();
  await expect(
    page.getByRole('complementary').getByRole('heading', { level: 3, name: 'Refund policy' }),
  ).toBeVisible();
  await expect(prompts).toBeHidden();
  expect(sent.find((r) => r.path.includes('/desktop/prompts/'))?.body).toMatchObject({
    resolution: 'accepted',
  });
});

test('the AI answers from the customer’s last sentence with its sources', async ({ page }) => {
  const { sent } = await desktop(page);
  await page.getByRole('tab', { name: 'Knowledge base' }).click();
  await page.getByRole('button', { name: "Use the customer's last sentence" }).click();
  await page.getByRole('button', { name: 'Answer with AI' }).click();
  const side = page.getByRole('complementary');
  await expect(side.getByText('Check the sources before telling the customer.')).toBeVisible();
  await side.getByRole('button', { name: 'Refund policy' }).click();
  await expect(side.getByRole('heading', { level: 3, name: 'Refund policy' })).toBeVisible();
  expect(sent.find((r) => r.path.endsWith('/v1/ai/suggestions'))?.body).toMatchObject({
    task: 'answer',
    text: 'How long does a refund take?',
  });
});

for (const theme of ['light', 'dark', 'high-contrast'])
  test(`knowledge tab and panel have no axe violations (${theme})`, async ({ page }) => {
    await page.addInitScript((value) => {
      localStorage.setItem('verbis.theme', value);
    }, theme);
    await desktop(page);
    await page.getByRole('tab', { name: 'Knowledge base' }).click();
    await page
      .getByRole('complementary')
      .getByRole('searchbox', { name: 'Search the knowledge base' })
      .fill('refund');
    await expect(
      page.getByRole('complementary').getByRole('button', { name: /Refund policy/ }),
    ).toBeVisible();
    await page.locator('.ag-runtime').getByRole('button', { name: 'Refund policy' }).click();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
  });
