import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const app = fileURLToPath(new URL('../../../../apps/docs-site/', import.meta.url));
export default defineConfig({
  testDir: `${app}/e2e`,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5186', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'pnpm exec astro preview --ignore-lock --host 127.0.0.1 --port 5186',
    cwd: app,
    url: 'http://127.0.0.1:5186/tr/',
    reuseExistingServer: false,
  },
});
