import { test } from '../../../tests/playwright/test.js';
import { editorFixture } from '../src/editor/fixtures.js';
import {
  fixtureResponse,
  scriptId,
  sessionFixture,
  tenantId,
  permissionFixture,
} from '../src/test-fixtures.js';

const sizes = [
  [1000, 540],
  [1440, 900],
] as const;
for (const [w, h] of sizes)
  test(`shot ${w}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.addInitScript(
      ({ tenant, user }) => {
        localStorage.setItem(`verbis.tour.${tenant}.${user}`, 'done');
        Object.defineProperty(navigator, 'languages', { get: () => ['tr'] });
      },
      { tenant: tenantId, user: sessionFixture.user.id },
    );
    await page.route(
      (u) => u.pathname.startsWith('/api/'),
      (route) => {
        const url = new URL(route.request().url());
        const fixture = editorFixture();
        fixture.document.meta.name = 'Müşteri karşılama';
        return route.fulfill({
          json: url.pathname.endsWith('/versions/1')
            ? fixture
            : url.pathname.endsWith('/permissions')
              ? { ...permissionFixture, rules: [...permissionFixture.rules, ['update', 'Script']] }
              : fixtureResponse(url.pathname + url.search),
        });
      },
    );
    await page.goto(`/scripts/${scriptId}/versions/1/edit`);
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: `/private/tmp/claude-501/-Users-ardamoustafa-agent-scripting/2c99e2c2-01fd-44fd-a83e-4c9e20673c2a/scratchpad/ed-${w}.png`,
    });
    await page.getByText('Önizleme / debugger').click();
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: `/private/tmp/claude-501/-Users-ardamoustafa-agent-scripting/2c99e2c2-01fd-44fd-a83e-4c9e20673c2a/scratchpad/pv-${w}.png`,
    });
    await page.getByText('Akış', { exact: true }).first().click();
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: `/private/tmp/claude-501/-Users-ardamoustafa-agent-scripting/2c99e2c2-01fd-44fd-a83e-4c9e20673c2a/scratchpad/fl-${w}.png`,
    });
  });
