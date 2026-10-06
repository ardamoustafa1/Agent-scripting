import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env['ADMIN_WEB_PORT'] ?? 5175);

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
    {
      name: 'live',
      testMatch: /.*-live\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env['LIVE_BASE_URL'] ?? `http://localhost:${port}`,
      },
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /(?:keycloak-.*|.*-live)\.spec\.ts/,
    },
    {
      // Real SSO against the dev stack: localhost origin (Keycloak redirect URIs, __Host- cookies).
      name: 'keycloak',
      testMatch: /keycloak-.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${port}` },
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
