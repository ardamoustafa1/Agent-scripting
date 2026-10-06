import { defineConfig, devices } from '/Users/ardamoustafa/agent scripting/node_modules/@playwright/test/index.mjs';
import base from '/Users/ardamoustafa/agent scripting/apps/agent-web/playwright.config.ts';
export default defineConfig({
 ...base,
 use: { ...base.use, baseURL: 'http://127.0.0.1:5274' },
 testDir: '/Users/ardamoustafa/agent scripting/apps/agent-web/e2e',
 grepInvert: /@visual/,
 projects: ['webkit', 'firefox'].map(name => ({ name, testIgnore: /(?:keycloak-.*|.*-live)\.spec\.ts/, use: { ...devices[name === 'webkit' ? 'Desktop Safari' : 'Desktop Firefox'] } })),
 webServer: { ...base.webServer, command: 'pnpm exec vite preview --port 5274', url: 'http://127.0.0.1:5274/health', reuseExistingServer: false, cwd: '/Users/ardamoustafa/agent scripting/apps/agent-web' },
 reporter: [['list'], ['json', { outputFile: '/tmp/verbis-product-audit-20261004/agent-web-cross.json' }]],
 outputDir: '/tmp/verbis-product-audit-20261004/agent-web-cross-results',
});
