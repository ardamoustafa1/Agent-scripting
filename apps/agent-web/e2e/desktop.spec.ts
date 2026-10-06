import { AxeBuilder } from '@axe-core/playwright';

import { minimalScript } from '@verbis/script-schema/fixtures';

import { expect, test, type Page } from '../../../tests/playwright/test.js';

const id = '01928f3a-0000-7000-8000-000000000001';
async function desktop(page: Page) {
  const document = minimalScript();
  const view = {
    id,
    state: 'active',
    sequence: 1,
    readOnly: true,
    snapshot: { variables: {}, currentPage: 'home', history: [], timers: {} },
  };
  const data = {
    document,
    view,
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
    campaign: { name: 'Synthetic campaign', outcomes: [] },
    writeback: 'none',
  };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
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
              : path.endsWith('/attach')
                ? {
                    ...view,
                    readOnly: false,
                    writeToken: 'a'.repeat(43),
                    leaseUntil: '2026-10-03T10:00:00Z',
                  }
                : path.endsWith('/state')
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
}
test('failed logout keeps the interaction visible and permits another attempt', async ({
  page,
}) => {
  await desktop(page);
  let attempts = 0;
  await page.route('**/api/auth/logout', async (route) => {
    attempts += 1;
    expect(route.request().headers()['x-csrf-token']).toBe('synthetic-csrf');
    await route.fulfill({ status: 503, json: { code: 'VERBIS_HTTP_UNAVAILABLE' } });
  });
  const logout = page.getByRole('button', { name: /^Sign out$|^Çıkış yap$/ });
  await logout.click();
  await expect(
    page.getByRole('alert').filter({ hasText: /Operation failed|İşlem başarısız/ }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Synthetic customer' })).toBeVisible();
  await expect(logout).toBeEnabled();
  await logout.click();
  await expect.poll(() => attempts).toBe(2);
});
test('empty live monitoring explains availability and prevents an empty dropdown', async ({
  page,
}) => {
  await desktop(page);
  await page.route('**/api/v1/me/permissions', (route) =>
    route.fulfill({ json: { roles: ['supervisor'] } }),
  );
  await page.route('**/api/v1/supervisor/sessions?*', (route) =>
    route.fulfill({ json: { data: [], page: { nextCursor: null } } }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: /^Live monitoring$|^Canlı izleme$/ }).click();
  await expect(page.getByRole('status')).toContainText(
    /No active sessions|İzlenebilecek aktif oturum/,
  );
  await expect(page.getByRole('combobox', { name: /^Interaction$|^Etkileşim$/ })).toBeDisabled();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
});
for (const theme of ['light', 'dark', 'high-contrast'])
  test(`desktop keyboard and axe (${theme})`, async ({ page }) => {
    await page.addInitScript((value) => {
      localStorage.setItem('verbis.theme', value);
    }, theme);
    await desktop(page);
    await page.keyboard.press('Control+/');
    await expect(
      page.getByRole('heading', { name: /Keyboard shortcuts|Klavye kısayolları/ }),
    ).toBeVisible();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
  });
test('retains encrypted note across a browser refresh without storing capabilities', async ({
  page,
}) => {
  await desktop(page);
  await page.getByRole('button', { name: /Side panel|Yan panel/ }).click();
  await page.getByRole('tab', { name: /Notes|Notlar/ }).click();
  await page.getByRole('textbox', { name: /^Notes$|^Notlar$/ }).fill('Synthetic encrypted note');
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open('verbis-agent-drafts', 1);
          req.onsuccess = () => {
            resolve(req.result);
          };
          req.onerror = () => {
            reject(req.error ?? new Error('Synthetic storage error'));
          };
        });
        return new Promise<boolean>((resolve) => {
          const req = db.transaction('drafts', 'readonly').objectStore('drafts').getAll();
          req.onsuccess = () => {
            const rows = req.result as { ciphertext: ArrayBuffer; iv: Uint8Array }[];
            resolve(
              rows.length > 0 &&
                rows.every(
                  (row) =>
                    row.ciphertext instanceof ArrayBuffer &&
                    row.iv.byteLength === 12 &&
                    !new TextDecoder().decode(row.ciphertext).includes('Synthetic encrypted note'),
                ),
            );
            db.close();
          };
        });
      }),
    )
    .toBe(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Synthetic customer' })).toBeVisible();
  await page.getByRole('button', { name: /Side panel|Yan panel/ }).click();
  await page.getByRole('tab', { name: /Notes|Notlar/ }).click();
  await expect(page.getByRole('textbox', { name: /^Notes$|^Notlar$/ })).toHaveValue(
    'Synthetic encrypted note',
  );
});

for (const theme of ['light', 'dark']) {
  test(`@visual agent-web main screen ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.clock.setFixedTime(new Date('2026-10-03T09:00:00Z'));
    await page.addInitScript((value) => {
      localStorage.setItem('verbis.theme', value);
    }, theme);
    await desktop(page);
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`agent-web-${theme}.png`, { fullPage: true });
  });
}
