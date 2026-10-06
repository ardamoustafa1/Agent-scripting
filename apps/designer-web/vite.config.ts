import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv as parseDotenv } from 'node:util';

import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig, type Plugin } from 'vite';
import { z } from 'zod';

import { envSchemas, parseEnv } from '@verbis/shared-types';

const repoRoot = path.resolve(import.meta.dirname, '../..');

// Build/dev-time env. Only VITE_* variables are ever exposed to the browser (no secrets there).
const EnvSchema = z.object({
  DESIGNER_WEB_PORT: envSchemas.port.default(5173),
  COLLABORATION_INTERNAL_URL: envSchemas.url.default('http://127.0.0.1:4010'),
  API_INTERNAL_URL: envSchemas.url.default('http://127.0.0.1:4000'),
  DESIGNER_ENVIRONMENT: z.enum(['dev', 'test', 'prod']).optional(),
  DESIGNER_DEV_URL: z.url().optional(),
  DESIGNER_TEST_URL: z.url().optional(),
  DESIGNER_PROD_URL: z.url().optional(),
});

/** Reads the root .env without mutating process.env (Vite's loadEnv would apply NODE_ENV). */
function readRootEnv(): Record<string, string | undefined> {
  const file = path.join(repoRoot, '.env');
  const fromFile = existsSync(file) ? parseDotenv(readFileSync(file, 'utf8')) : {};
  return { ...fromFile, ...process.env };
}

/** GET /health for dev and preview servers (production images answer it in nginx). */
function healthPlugin(service: string): Plugin {
  const handler = (
    _req: unknown,
    res: { setHeader(k: string, v: string): void; end(body: string): void },
  ) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ status: 'ok', service, version: '0.0.0-dev', checks: {} }));
  };
  return {
    name: 'verbis-health',
    configureServer(server) {
      server.middlewares.use('/health', handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/health', handler);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = parseEnv(EnvSchema, readRootEnv());
  const urls = {
    dev: env.DESIGNER_DEV_URL,
    test: env.DESIGNER_TEST_URL,
    prod: env.DESIGNER_PROD_URL,
  };
  for (const value of Object.values(urls)) {
    if (!value) continue;
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      url.hash ||
      url.search ||
      url.pathname !== '/' ||
      !(
        url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
      )
    )
      throw new Error('VERBIS_DESIGNER_ENVIRONMENT_URL');
  }
  const proxy = {
    '/collaboration': { target: env.COLLABORATION_INTERNAL_URL, ws: true, changeOrigin: false },
    '/api': {
      target: env.API_INTERNAL_URL,
      changeOrigin: false,
      rewrite: (p: string) => p.replace(/^\/api/, ''),
    },
  };
  return {
    // The root .env holds server-side settings (and NODE_ENV); never let Vite expose or apply them.
    // Browser-visible config, when needed, must be added explicitly via `define` after review.
    envDir: false as const,
    html: { cspNonce: '__VERBIS_CSP_NONCE__' },
    define: {
      __VERBIS_DESIGNER_DEPLOYMENT__: JSON.stringify({
        environment: env.DESIGNER_ENVIRONMENT ?? (mode === 'production' ? 'prod' : 'dev'),
        urls,
      }),
    },
    plugins: [
      react(),
      healthPlugin('verbis-designer-web'),
      ...(process.env['VERBIS_ANALYZE'] === '1'
        ? [
            visualizer({
              filename: 'dist/bundle-analysis.html',
              gzipSize: true,
              brotliSize: true,
              open: false,
            }),
          ]
        : []),
    ],
    resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
    server: { host: '127.0.0.1', port: env.DESIGNER_WEB_PORT, strictPort: true, proxy },
    preview: { host: '127.0.0.1', port: env.DESIGNER_WEB_PORT, strictPort: true, proxy },
    // Keep fonts as same-origin assets; strict production CSP rejects data URLs.
    build: { sourcemap: false, assetsInlineLimit: 0 },
  };
});
