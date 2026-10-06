import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv as parseDotenv } from 'node:util';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { z } from 'zod';

import { envSchemas, parseEnv } from '@verbis/shared-types';

import { browserChunks } from '../../scripts/browser-chunks.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../..');

// Build/dev-time env. Only VITE_* variables are ever exposed to the browser (no secrets there).
const EnvSchema = z.object({
  AGENT_WEB_PORT: envSchemas.port.default(5174),
  API_INTERNAL_URL: envSchemas.url.default('http://127.0.0.1:4000'),
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

export default defineConfig(() => {
  const env = parseEnv(EnvSchema, readRootEnv());
  const proxy = {
    '/telemetry': {
      target: 'http://127.0.0.1:4318',
      rewrite: (p: string) => p.replace(/^\/telemetry/, ''),
    },
    '/socket.io': { target: env.API_INTERNAL_URL, ws: true, changeOrigin: false },
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
    define: {
      'import.meta.env.VITE_OTEL_ENABLED': JSON.stringify(
        process.env['VITE_OTEL_ENABLED'] ?? 'false',
      ),
    },
    html: { cspNonce: '__VERBIS_CSP_NONCE__' },
    plugins: [react(), healthPlugin('verbis-agent-web')],
    resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
    server: { host: '127.0.0.1', port: env.AGENT_WEB_PORT, strictPort: true, proxy },
    preview: { host: '127.0.0.1', port: env.AGENT_WEB_PORT, strictPort: true, proxy },
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: browserChunks, includeDependenciesRecursively: false, maxSize: 350000 },
            ],
          },
          strictExecutionOrder: true,
        },
      },
      sourcemap: false,
    },
  };
});
