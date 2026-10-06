import { expect, test } from '../../../tests/playwright/test.js';

const enabled = process.env['E2E_LIVE'] === '1';
const storage = process.env['ADMIN_E2E_STORAGE_STATE'];
const fromSeq = process.env['AUDIT_E2E_FROM_SEQ'];
const toSeq = process.env['AUDIT_E2E_TO_SEQ'];
if (enabled && (!storage || !fromSeq || !toSeq))
  throw new Error(
    'Live audit acceptance requires ADMIN_E2E_STORAGE_STATE and AUDIT_E2E_FROM_SEQ/TO_SEQ',
  );
test.use({
  locale: 'en-US',
  ...(storage ? { storageState: storage } : {}),
  trace: 'off',
  screenshot: 'off',
  video: 'off',
});
test('audit view filters real events and verifies a specified chain range', async ({ page }) => {
  test.skip(!enabled, 'Disposable synthetic tenant and an audited event range required');
  await page.goto('/#audit');
  await expect(page.getByRole('heading', { level: 1, name: 'Audit logs' })).toBeVisible();
  await page.getByLabel('From sequence', { exact: true }).fill(fromSeq!);
  await page.getByLabel('To sequence', { exact: true }).fill(toSeq!);
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/audit-events/verify') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Verify integrity', exact: true }).click();
  const verified = await response;
  expect(verified.ok()).toBe(true);
  expect(await verified.json()).toMatchObject({ valid: true, truncated: false });
  await expect(page.locator('.aw-card > [role="status"]')).toContainText('Checked range verified');
  await page
    .getByLabel('Action', { exact: true })
    .fill(process.env['AUDIT_E2E_ACTION'] ?? 'script.version.published');
  const filtered = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname.endsWith('/audit-events') &&
      new URL(r.url()).searchParams.has('action'),
  );
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  expect((await filtered).ok()).toBe(true);
});
