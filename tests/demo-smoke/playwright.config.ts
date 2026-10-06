import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'demo.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env['CI']),
  timeout: 120_000,
  reporter: [['list'], ['html', { outputFolder: '../../reports/demo-smoke', open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    locale: 'en-US',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
});
