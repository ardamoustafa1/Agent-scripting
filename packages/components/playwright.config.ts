import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://127.0.0.1:6007',
    browserName: 'chromium',
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce',
  },
  webServer: {
    command: 'pnpm exec storybook dev -p 6007 --no-open --ci',
    url: 'http://127.0.0.1:6007',
    timeout: 120000,
    reuseExistingServer: !process.env['CI'],
  },
  reporter: [['list'], ['html', { open: 'never' }]],
});
