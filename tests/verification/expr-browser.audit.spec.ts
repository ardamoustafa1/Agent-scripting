import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser } from '@playwright/test';

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from '../../apps/api/node_modules/vitest/dist/index.js';
import { tryEvaluate } from '../../packages/expr/src/index.js';

const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const esbuild = createRequire(require.resolve('vite'))('esbuild') as {
  build(options: Record<string, unknown>): Promise<{ outputFiles: { text: string }[] }>;
};
let browser: Browser, server: ReturnType<typeof createServer>, url: string;
const cases = [
  { source: '1 + 2 * 3', context: {} },
  { source: 'map(vars.items, x => x + 1)', context: { vars: { items: [1, 2, 3] } } },
  { source: 'vars["__proto__"].polluted', context: { vars: {} } },
  { source: 'vars.constructor', context: { vars: {} } },
  { source: 'while(true) {}', context: {} },
  { source: '('.repeat(40) + '1' + ')'.repeat(40), context: {} },
  { source: 'sum(vars.items)', context: { vars: { items: [2, 3, 4] } } },
];
beforeAll(async () => {
  const bundle = await esbuild.build({
    entryPoints: [fileURLToPath(new URL('../../packages/expr/src/index.ts', import.meta.url))],
    bundle: true,
    format: 'iife',
    globalName: 'V2Expression',
    platform: 'browser',
    write: false,
  });
  server = createServer((req, res) => {
    res.setHeader('content-type', req.url === '/engine.js' ? 'text/javascript' : 'text/html');
    res.end(
      req.url === '/engine.js'
        ? bundle.outputFiles[0]?.text
        : '<script src="/engine.js"></script><p>Expression parity audit</p>',
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  url = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    }),
  );
});
describe('V2 Node Chromium expression parity', () => {
  it.each(cases)(
    '$source returns exactly the same value or error code',
    async ({ source, context }) => {
      const page = await browser.newPage();
      await page.goto(url);
      const normalize = (x: ReturnType<typeof tryEvaluate>) =>
        x.ok ? { ok: true, value: x.value } : { ok: false, code: x.error.code };
      const node = normalize(tryEvaluate(source, context, { budgetClock: () => 0 }));
      const web = await page.evaluate(
        ({ source, context }) => {
          const engine = Reflect.get(globalThis, 'V2Expression') as {
            tryEvaluate: (
              s: string,
              c: unknown,
              o: unknown,
            ) => { ok: boolean; value?: unknown; error?: { code: string } };
          };
          const x = engine.tryEvaluate(source, context, { budgetClock: () => 0 });
          return x.ok ? { ok: true, value: x.value } : { ok: false, code: x.error?.code };
        },
        { source, context },
      );
      expect(web).toEqual(node);
      await page.close();
    },
  );
  it('production expression TypeScript has no executable eval Function vm or dynamic import', () => {
    const files = [
      'interpreter',
      'parser',
      'runtime',
      'registry',
      'types',
      'analysis',
      'templates',
      'rules',
      'validators',
      'rewrite',
    ];
    for (const file of files) {
      const code = readFileSync(
        new URL(`../../packages/expr/src/${file}.ts`, import.meta.url),
        'utf8',
      );
      expect(code).not.toMatch(/\beval\s*\(|\b(?:new\s+)?Function\s*\(|\bimport\s*\(|node:vm/);
    }
  });
});
