import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '../../../../node_modules/@playwright/test/index.mjs';
import base from '../../../../apps/designer-web/playwright.config.ts';
export default defineConfig({
  ...base,
  testDir: fileURLToPath(new URL('../../../../apps/designer-web/e2e', import.meta.url)),
  projects: ['firefox', 'webkit'].map((name) => ({ name, use: { ...devices[name === 'webkit' ? 'Desktop Safari' : 'Desktop Firefox'] } })),
  webServer: { ...base.webServer, cwd: fileURLToPath(new URL('../../../../apps/designer-web', import.meta.url)), reuseExistingServer: false },
  reporter: [['list']],
  outputDir: './cross-results',
});
