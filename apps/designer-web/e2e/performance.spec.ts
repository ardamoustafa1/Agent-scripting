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
// P-16: each inspector keystroke remounted every canvas node (host keyed by store revision),
// rebuilt the preview runtime and re-rendered all node frames: ≈64 ms median per key at 900 nodes
// before the fix (149 ms at 1,000 in the audit). Keystroke → next frame must stay interactive.
test('900 nodes keep inspector typing latency within the input budget', async ({ page }, info) => {
  await page.route('**/api/v1/scripts/*/versions/1', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(editorFixture(900)), // + heading stays under the node limit
    }),
  );
  await page.goto(`/scripts/${scriptId}/versions/1/edit`);
  await page
    .locator('.ed-palette [data-component-type="heading"]')
    .getByRole('button')
    .last()
    .click();
  const inspector = page.locator('.ed-inspector');
  await inspector
    .getByRole('textbox', { name: / · TR$/ })
    .first()
    .fill('Sentetik selamlama');
  await expect(page.getByText('Fix document errors to preview.')).toHaveCount(0);
  const field = inspector.getByRole('textbox', { name: / · EN$/ }).first();
  await field.click();
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const store = globalThis as unknown as { __keyLatency: number[] };
    store.__keyLatency = [];
    document.addEventListener(
      'keydown',
      (event) => {
        const start = event.timeStamp;
        requestAnimationFrame(() =>
          setTimeout(() => store.__keyLatency.push(performance.now() - start), 0),
        );
      },
      true,
    );
  });
  await page.keyboard.type('Synthetic greeting text', { delay: 60 });
  await expect(field).toHaveValue(/Synthetic greeting text$/);
  await page.waitForTimeout(500);
  const latency = await page.evaluate(
    () => (globalThis as unknown as { __keyLatency: number[] }).__keyLatency,
  );
  // The first key after a pause applies to the canvas immediately; the rest are coalesced.
  const steady = latency.slice(1).sort((a, b) => a - b);
  const median = steady[Math.floor(steady.length / 2)] ?? 0,
    p95 = steady[Math.floor(steady.length * 0.95)] ?? 0;
  await info.attach('inspector-typing-latency', {
    body: JSON.stringify({ median, p95, first: latency[0], samples: latency }),
    contentType: 'application/json',
  });
  expect(latency).toHaveLength(23);
  // Shared CI runners are ~2x slower than the developer hardware the budget was set on.
  const factor = process.env['CI'] ? 2 : 1;
  expect(median).toBeLessThan(50 * factor);
  expect(p95).toBeLessThan(100 * factor);
  // The canvas catches up once typing pauses and still renders every node.
  await expect(page.getByText('Fix document errors to preview.')).toHaveCount(0);
  expect(await page.locator('.ed-canvas-area [data-editor-node]').count()).toBeGreaterThan(900);
});
