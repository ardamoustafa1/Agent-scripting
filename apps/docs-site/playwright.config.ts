import { defineConfig, devices } from '@playwright/test';
const crossBrowser = process.env['DOCS_CROSS_BROWSER'] === '1';
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }]],
  use: { baseURL: 'http://127.0.0.1:5176', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ...(crossBrowser
      ? [
          { name: 'webkit', use: { ...devices['Desktop Safari'] } },
          { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
        ]
      : []),
  ],
  webServer: {
    command: 'pnpm exec astro preview --ignore-lock --host 127.0.0.1 --port 5176',
    url: 'http://127.0.0.1:5176/tr/',
    reuseExistingServer: false,
  },
});
