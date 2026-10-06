import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './benchmark',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'benchmark-report' }]],
  use: {
    baseURL: 'http://127.0.0.1:6017',
    browserName: 'chromium',
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: 'pnpm benchmark:serve',
    url: 'http://127.0.0.1:6017',
    reuseExistingServer: !process.env['CI'],
    timeout: 60_000,
  },
});
