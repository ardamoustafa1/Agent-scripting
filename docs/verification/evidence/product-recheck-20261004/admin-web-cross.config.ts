import { defineConfig, devices } from '/Users/ardamoustafa/agent scripting/node_modules/@playwright/test/index.mjs';
import base from '/Users/ardamoustafa/agent scripting/apps/admin-web/playwright.config.ts';
export default defineConfig({
 ...base,
 use: { ...base.use, baseURL: 'http://127.0.0.1:5275' },
 testDir: '/Users/ardamoustafa/agent scripting/apps/admin-web/e2e',
 grepInvert: /@visual/,
 projects: ['webkit', 'firefox'].map(name => ({ name, testIgnore: /(?:keycloak-.*|.*-live)\.spec\.ts/, use: { ...devices[name === 'webkit' ? 'Desktop Safari' : 'Desktop Firefox'] } })),
 webServer: { ...base.webServer, command: 'pnpm exec vite preview --port 5275', url: 'http://127.0.0.1:5275/health', reuseExistingServer: false, cwd: '/Users/ardamoustafa/agent scripting/apps/admin-web' },
 reporter: [['list'], ['json', { outputFile: '/tmp/verbis-product-recheck-20261004/admin-web-cross.json' }]],
 outputDir: '/tmp/verbis-product-recheck-20261004/admin-web-cross-results',
});
