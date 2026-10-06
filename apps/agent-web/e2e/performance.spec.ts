import { expect, test } from '../../../tests/playwright/test.js';

const storage = process.env['AGENT_E2E_STORAGE_STATE'];
const session = process.env['AGENT_E2E_SESSION_ID'];
if (process.env['AGENT_E2E_PERFORMANCE'] === '1' && (!storage || !session))
  throw new Error(
    'Performance acceptance requires AGENT_E2E_STORAGE_STATE and AGENT_E2E_SESSION_ID',
  );
test.use({ ...(storage ? { storageState: storage } : {}), locale: 'en-US' });
test('real desktop load and page-transition budgets', async ({ page }) => {
  test.setTimeout(90000);
  test.skip(
    process.env['AGENT_E2E_PERFORMANCE'] !== '1' || !storage || !session,
    'Requires opt-in SSO session and an active published multi-page script',
  );
  for (const budget of [1500, 500]) {
    await page.goto(`/s/${session}`);
    await expect(page.locator('.ag-runtime[data-page-id]')).toBeVisible();
    const ready = await page.evaluate(() => performance.now());
    expect(ready).toBeLessThan(budget);
  }
  await expect(page.locator('[data-agent-next]')).toBeEnabled({ timeout: 65000 });
  const elapsed = await page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const field = document.querySelector('.ag-runtime[data-page-id]');
        const button = document.querySelector<HTMLButtonElement>('[data-agent-next]');
        if (!field || !button || button.disabled) {
          reject(new Error('Synthetic test session is not editable'));
          return;
        }
        const prior = field.getAttribute('data-page-id'),
          started = performance.now();
        const timeout = setTimeout(() => {
          observer.disconnect();
          reject(new Error('Page did not advance'));
        }, 5000);
        const observer = new MutationObserver(() => {
          if (field.getAttribute('data-page-id') !== prior) {
            clearTimeout(timeout);
            observer.disconnect();
            resolve(performance.now() - started);
          }
        });
        observer.observe(field, { attributes: true, attributeFilter: ['data-page-id'] });
        button.click();
      }),
  );
  expect(elapsed).toBeLessThan(100);
});
