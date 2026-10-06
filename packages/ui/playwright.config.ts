import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  // Axe injects a single runner into Storybook's page. Keep one worker so parallel
  // component suites cannot start a second analysis before the first promise settles.
  ...(process.env['CI'] ? { workers: 1 } : {}),
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:6006',
    trace: 'retain-on-failure',
    locale: 'tr-TR',
    timezoneId: 'Europe/Istanbul',
    reducedMotion: 'reduce',
    viewport: { width: 1280, height: 900 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  expect: { toHaveScreenshot: { animations: 'disabled', maxDiffPixels: 0 } },
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  webServer: {
    command: 'UI_E2E_AXE=1 pnpm exec storybook dev -p 6006 --no-open --ci',
    url: 'http://127.0.0.1:6006',
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
