import { expect, test, type Page } from '../../../tests/playwright/test.js';

const enabled = process.env['E2E_LIVE'] === '1';
const required = (key: string) => {
  const value = process.env[key];
  if (enabled && !value)
    throw new Error(`${key} is required for two-browser collaboration acceptance`);
  return value ?? '';
};
const authorState = required('DESIGNER_E2E_AUTHOR_STATE');
const peerState = required('DESIGNER_E2E_PEER_STATE');
const script = required('DESIGNER_E2E_SCRIPT_ID');
const number = required('DESIGNER_E2E_DRAFT_NUMBER');
test.use({ locale: 'en-US', trace: 'off', screenshot: 'off', video: 'off' });
const mode = async (page: Page, name: string) => {
  await page.getByRole('combobox', { name: 'Editor', exact: true }).click();
  await page.getByRole('option', { name, exact: true }).click();
};
test('two isolated browsers synchronize edits, flush and retain them after reconnect', async ({
  browser,
  baseURL,
}) => {
  test.skip(!enabled, 'Requires two distinct synthetic SSO identities and a disposable draft');
  if (!baseURL) throw new Error('Live designer baseURL is required');
  const author = await browser.newContext({ storageState: authorState, baseURL, locale: 'en-US' });
  const peer = await browser.newContext({ storageState: peerState, baseURL, locale: 'en-US' });
  try {
    const first = await author.newPage(),
      second = await peer.newPage();
    const route = `/scripts/${script}/versions/${number}/edit`;
    await Promise.all([first.goto(route), second.goto(route)]);
    // The server enforces tenant/session identity; two contexts must not share cookies.
    const identities = await Promise.all(
      [first, second].map(async (page) => {
        const response = await page.request.get('/api/auth/session');
        expect(response.ok()).toBe(true);
        return (await response.json()) as { user: { id: string; tenantId: string } };
      }),
    );
    expect(identities[0]!.user.id).not.toBe(identities[1]!.user.id);
    expect(identities[0]!.user.tenantId).toBe(identities[1]!.user.tenantId);
    for (const page of [first, second]) {
      await page.getByRole('button', { name: 'Join collaborative editing', exact: true }).click();
      await expect(page.getByText('Saved · connected', { exact: true })).toBeVisible();
      await mode(page, 'Rules');
    }
    await first.getByRole('button', { name: 'Add rule', exact: true }).click();
    await first.getByLabel('Description', { exact: true }).fill('Synthetic shared rule');
    // Re-selecting the new rule proves Yjs replicated the remote document, rather than a local DOM edit.
    await second.getByRole('combobox', { name: 'Rule builder', exact: true }).click();
    await expect(
      second.getByRole('option', { name: 'Synthetic shared rule', exact: true }),
    ).toBeVisible();
    await second.getByRole('option', { name: 'Synthetic shared rule', exact: true }).click();
    await second.getByLabel('Description', { exact: true }).fill('Synthetic peer update');
    await expect(first.getByLabel('Description', { exact: true })).toHaveValue(
      'Synthetic peer update',
    );
    await first.getByRole('button', { name: 'Save and close room', exact: true }).click();
    await second.getByRole('button', { name: 'Save and close room', exact: true }).click();
    await first.reload();
    await mode(first, 'Rules');
    await first.getByRole('combobox', { name: 'Rule builder', exact: true }).click();
    await first.getByRole('option', { name: 'Synthetic peer update', exact: true }).click();
    await expect(first.getByLabel('Description', { exact: true })).toHaveValue(
      'Synthetic peer update',
    );
  } finally {
    await Promise.all([author.close(), peer.close()]);
  }
});
