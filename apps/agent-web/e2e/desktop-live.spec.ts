import { expect, test } from '../../../tests/playwright/test.js';

// Opt-in real connector/BFF workflow. Auth storage is local and must never be committed.
const connector = process.env['AGENT_E2E_CONNECTOR_ID'];
const actor = process.env['AGENT_E2E_PLATFORM_USER'];
const storage = process.env['AGENT_E2E_STORAGE_STATE'];
if (process.env['E2E_LIVE'] === '1' && (!connector || !actor || !storage))
  throw new Error(
    'Live simulator acceptance requires AGENT_E2E_CONNECTOR_ID, AGENT_E2E_PLATFORM_USER and AGENT_E2E_STORAGE_STATE',
  );
test.use({
  ...(storage ? { storageState: storage } : {}),
  locale: 'en-US',
  trace: 'off',
  screenshot: 'off',
  video: 'off',
});
test('simulator offer → secure launch → inputs → data source → wrap-up → platform write-back', async ({
  page,
}) => {
  test.skip(
    process.env['E2E_LIVE'] !== '1' || !connector || !actor || !storage,
    'Requires seeded dev simulator, published campaign and SSO storage state',
  );
  await page.goto('/');
  const auth = await page.request.get('/api/auth/session');
  expect(auth.ok()).toBe(true);
  const { csrfToken } = (await auth.json()) as { csrfToken: string };
  const headers = { 'x-csrf-token': csrfToken };
  await expect(page.getByText(/Waiting for an interaction|Etkileşim bekleniyor/)).toBeVisible();
  const call = await page.request.post(`/api/v1/simulator/connectors/${connector}/interactions`, {
    headers,
    data: {
      channel: 'voice',
      agentPlatformUserId: actor,
      customerName: 'Synthetic desktop customer',
      autoConnect: true,
      attributes: { customerName: 'Synthetic desktop customer' },
    },
  });
  expect(call.ok()).toBe(true);
  const interaction = (await call.json()) as { platformInteractionId: string };
  await expect(page).toHaveURL(/\/s\/[0-9a-f-]{36}$/);
  const sessionId = page.url().split('/').at(-1);
  const inputLabel = process.env['AGENT_E2E_INPUT_LABEL'] ?? 'Customer name';
  await page.getByLabel(inputLabel, { exact: true }).fill('Synthetic edited customer');
  const dataCall = page.waitForResponse(
    (response) =>
      response.url().endsWith('/desktop/data-source') && response.request().method() === 'POST',
  );
  await page
    .getByRole('button', { name: process.env['AGENT_E2E_LOOKUP_LABEL'] ?? 'Lookup', exact: true })
    .click();
  expect((await dataCall).ok()).toBe(true);
  await page
    .getByRole('button', { name: /^Next$|^İleri$/ })
    .last()
    .click();
  const wrap = await page.request.post(
    `/api/v1/simulator/connectors/${connector}/interactions/${interaction.platformInteractionId}/actions`,
    { headers, data: { action: 'wrapup' } },
  );
  expect(wrap.ok()).toBe(true);
  await expect(
    page.getByRole('heading', { name: /Wrap up|Görüşme sonrası|Kapanış/ }),
  ).toBeVisible();
  await page.getByRole('combobox', { name: /Disposition|Sonuç kodu/ }).click();
  await page
    .getByRole('option', { name: process.env['AGENT_E2E_OUTCOME_LABEL'] ?? 'Success', exact: true })
    .click();
  await page
    .getByLabel(/^Notes$|^Notlar$/)
    .first()
    .fill('Synthetic acceptance note');
  await page.getByRole('button', { name: /Submit outcome|Sonucu gönder/ }).click();
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/v1/sessions/${sessionId}/desktop`);
        return ((await response.json()) as { writeback: string }).writeback;
      },
      { timeout: 30000 },
    )
    .toBe('success');
  const snapshot = await page.request.get(`/api/v1/simulator/connectors/${connector}`);
  expect(snapshot.ok()).toBe(true);
  const commands = (
    (await snapshot.json()) as { commands: { platformInteractionId: string; command: string }[] }
  ).commands;
  expect(
    commands.some(
      (command) =>
        command.platformInteractionId === interaction.platformInteractionId &&
        command.command === 'setWrapUp',
    ),
  ).toBe(true);
});
