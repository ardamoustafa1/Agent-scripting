import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const swc = require('unplugin-swc').default;

const { defineConfig } = await import(require.resolve('vitest/config'));
if (process.env.CI && process.env.V2_NO_DB)
  throw new Error('CI verification requires the real database setup');
export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  resolve: {
    alias: { jose: require.resolve('jose'), testcontainers: require.resolve('testcontainers') },
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['tests/verification/**/*.audit.spec.ts'],
    globalSetup: process.env.V2_NO_DB
      ? []
      : [
          fileURLToPath(
            new URL('../../apps/api/test/integration/global-setup.ts', import.meta.url),
          ),
        ],
    fileParallelism: false,
    testTimeout: 90000,
    hookTimeout: 240000,
  },
});
