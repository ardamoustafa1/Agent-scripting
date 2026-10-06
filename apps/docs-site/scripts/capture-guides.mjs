/** Opt-in image capture only: no login, seed, clicks, publication or test runner. */
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { validateCapture } from './capture-policy.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
const manifestPath = process.env.DOCS_CAPTURE_MANIFEST;
const authDir = process.env.DOCS_CAPTURE_AUTH_DIR;
const origins = process.env.DOCS_CAPTURE_ALLOWED_ORIGINS?.split(',').map((item) => item.trim());
if (!manifestPath || !authDir || !origins?.length)
  throw new Error(
    'Set DOCS_CAPTURE_MANIFEST, DOCS_CAPTURE_AUTH_DIR and DOCS_CAPTURE_ALLOWED_ORIGINS',
  );
const steps = validateCapture(
  JSON.parse(await readFile(manifestPath, 'utf8')),
  origins,
  authDir,
  root,
);
const output = fileURLToPath(new URL('../public/guides/captured/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
try {
  for (const step of steps) {
    const locale = step.name.endsWith('-tr') ? 'tr-TR' : 'en-US';
    const context = await browser.newContext({
      storageState: step.authState,
      locale,
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'reduce',
      colorScheme: 'light',
    });
    try {
      // Block unexpected document redirects; API calls may still use the configured BFF.
      await context.route('**/*', async (route) => {
        const request = route.request();
        if (request.isNavigationRequest() && !origins.includes(new URL(request.url()).origin))
          await route.abort();
        else await route.continue();
      });
      const page = await context.newPage();
      await page.goto(step.url, { waitUntil: 'domcontentloaded' });
      await page.locator(step.readySelector).waitFor({ state: 'visible' });
      await page.screenshot({
        path: output + step.name + '.png',
        fullPage: true,
        animations: 'disabled',
        mask: [
          ...(step.mask ?? []),
          'input[type="password"]',
          '[data-classification="pii"]',
          '[data-sensitive="true"]',
        ].map((selector) => page.locator(selector)),
      });
      process.stdout.write(step.name + '.png — review before publishing\n');
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
