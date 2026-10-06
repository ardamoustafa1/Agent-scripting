import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env['DESIGNER_WEB_PORT'] ?? 5173);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  reporter: [
    [process.env['CI'] ? 'github' : 'list'],
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ['../../tests/playwright/flaky-reporter.ts'],
  ],
  expect: { toHaveScreenshot: { animations: 'disabled', maxDiffPixelRatio: 0.001 } },
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', testIgnore: /.*-live\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'live',
      testMatch: /.*-live\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env['LIVE_BASE_URL'] ?? `http://127.0.0.1:${port}`,
      },
    },
  ],
  ...(process.env['E2E_LIVE'] === '1'
    ? {}
    : {
        webServer: {
          command: 'pnpm exec vite preview',
          url: `http://127.0.0.1:${port}/health`,
          reuseExistingServer: !process.env['CI'],
          timeout: 60_000,
        },
      }),
});
