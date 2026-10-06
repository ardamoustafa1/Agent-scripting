import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // SWC keeps decorator metadata, which NestJS dependency injection relies on.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['src/**/*.spec.ts'] },
      },
      {
        // Real PostgreSQL 16, Redis 7 and NATS JetStream via Testcontainers (Docker required).
        extends: true,
        test: {
          name: 'integration',
          include: ['test/integration/**/*.int.spec.ts'],
          globalSetup: ['test/integration/global-setup.ts'],
          testTimeout: 60_000,
          hookTimeout: 240_000,
          fileParallelism: false,
        },
      },
      {
        // Throughput gates (Docker required): `pnpm --filter @verbis/api test:perf`.
        extends: true,
        test: {
          name: 'perf',
          include: ['test/perf/**/*.perf.spec.ts'],
          globalSetup: ['test/integration/global-setup.ts'],
          testTimeout: 300_000,
          hookTimeout: 240_000,
          fileParallelism: false,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'lcov', 'html'],
      reportOnFailure: true,
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.spec.ts', 'src/main.ts', 'src/telemetry.ts', 'src/generated/**'],
      thresholds: { lines: 85, functions: 85, branches: 85, statements: 85 },
    },
  },
});
