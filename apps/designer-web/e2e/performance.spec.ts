import { expect, test } from '../../../tests/playwright/test.js';
import { editorFixture } from '../src/editor/fixtures.js';
import {
  fixtureResponse,
  scriptId,
  sessionFixture,
  tenantId,
  permissionFixture,
} from '../src/test-fixtures.js';

// Trace snapshots serialize the 1,000-node DOM on every mouse move and distort
// the frame budget. Preserve raw timing evidence for this isolated benchmark.
test.use({ locale: 'en-US', trace: 'off' });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ tenant, user }) => {
      localStorage.setItem(`verbis.tour.${tenant}.${user}`, 'done');
    },
    { tenant: tenantId, user: sessionFixture.user.id },
  );
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const body = url.pathname.endsWith('/versions/1')
      ? editorFixture()
      : url.pathname.endsWith('/permissions')
        ? { ...permissionFixture, rules: [...permissionFixture.rules, ['update', 'Script']] }
        : route.request().method() === 'PUT'
          ? { version: 2 }
          : fixtureResponse(url.pathname + url.search);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
});
test('1000 nodes keep the layer DOM bounded and record a drag frame budget', async ({
  page,
}, info) => {
  await page.route('**/api/v1/scripts/*/versions/1', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(editorFixture(1000)),
    }),
  );
  await page.goto(`/scripts/${scriptId}/versions/1/edit`);
  await page.getByRole('tab', { name: 'Layers', exact: true }).click();
  expect(await page.getByRole('treeitem').count()).toBeLessThan(80);
  const source = page.getByRole('treeitem').nth(1).locator('.ed-grip').first();
  const rect = await source.boundingBox();
  if (!rect) throw new Error('Missing drag handle');
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  const measuring = page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const raf = (
          globalThis as unknown as {
            requestAnimationFrame: (callback: (now: number) => void) => number;
          }
        ).requestAnimationFrame;
        const samples: number[] = [];
        let previous = performance.now();
        function next(now: number) {
          samples.push(now - previous);
          previous = now;
          if (samples.length === 120) resolve(samples);
          else raf(next);
        }
        raf(next);
      }),
  );
  for (let i = 0; i < 120; i++) {
    await page.mouse.move(rect.x + 40 + (i % 6), rect.y + 60 + (i % 100), { steps: 1 });
  }
  const frames = await measuring;
  await page.mouse.up();
  const fps = (frames.length * 1000) / frames.reduce((total, frame) => total + frame, 0);
  frames.sort((a, b) => a - b);
  await info.attach('drag-frame-budget', {
    body: JSON.stringify({ fps, p95: frames[Math.floor(frames.length * 0.95)], frames }),
    contentType: 'application/json',
  });
  // WebKit rounds individual timestamps to milliseconds. Measure sustained FPS
  // over the complete window so a 17 ms rounded median cannot reject 60 Hz.
  expect(fps).toBeGreaterThanOrEqual(59);
  expect(frames[Math.floor(frames.length * 0.95)]).toBeLessThan(20);
});
