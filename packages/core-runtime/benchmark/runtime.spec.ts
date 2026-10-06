import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
// window type is declared by the fixture; type-only import does not mount it in the test runner.
import type {} from './main.js';

test('500 nodes: initial React commit + layout <100ms; input p95 <16ms; unrelated nodes remain unchanged', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.runtimeBenchmark));
  const initial: number[] = [],
    preparation: number[] = [];
  // First cold renderer sample is included. Each mount gets a fresh engine, registry and store.
  for (let sample = 0; sample < 10; sample++) {
    const result = await page.evaluate(() => window.runtimeBenchmark.mount());
    expect(result.nodeCount).toBe(500);
    initial.push(result.initialMs);
    preparation.push(result.preparationMs);
  }
  const before = await page.evaluate(() => window.runtimeBenchmark.metrics().renderCounts);
  for (let sample = 0; sample < 30; sample++)
    await page.locator('#field-0').fill(`synthetic-${sample}`);
  const metrics = await page.evaluate(() => window.runtimeBenchmark.metrics());
  const durations = [...metrics.inputDurations].sort((a, b) => a - b);
  expect(durations.length).toBeGreaterThanOrEqual(30);
  const inputP95 = durations[Math.ceil(durations.length * 0.95) - 1]!;
  await testInfo.attach('runtime-performance', {
    body: JSON.stringify(
      {
        initial,
        preparation,
        inputDurations: metrics.inputDurations,
        inputP95,
        browser: 'chromium',
        nodeCount: 500,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  expect(Math.max(...initial)).toBeLessThan(100);
  expect(inputP95).toBeLessThan(16);
  for (let index = 1; index < 499; index++)
    expect(metrics.renderCounts[`field-${index}`]).toBe(before[`field-${index}`]);
  await page.evaluate(() => {
    window.runtimeBenchmark.dispose();
  });
});

test('runtime fields have accessible names and no axe violations', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.runtimeBenchmark));
  await page.evaluate(() => window.runtimeBenchmark.mount());
  const results = await new AxeBuilder({ page }).include('#root').analyze();
  expect(results.violations).toEqual([]);
});
