import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: {
    // Bound JSDOM workers so UI interaction tests keep their existing timing budgets.
    maxWorkers: 2,
    environment: 'jsdom',
    include: ['src/**/*.spec.tsx', 'src/**/*.spec.ts'],
    setupFiles: ['./src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'lcov', 'html'],
      reportOnFailure: true,
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.spec.*', 'src/test-setup.ts', 'src/main.tsx'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
        'src/workspace/**': { lines: 80, functions: 80, branches: 80, statements: 80 },
      },
    },
  },
});
