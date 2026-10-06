import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'lcov', 'html'],
      reportOnFailure: true,
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.spec.*', 'src/test-setup.ts', 'src/index.ts', 'src/fixtures/index.ts'],
      // Shared contract for every app (CLAUDE.md §8): held to the security-critical floor.
      thresholds: { lines: 95, functions: 95, branches: 90, statements: 95 },
    },
  },
});
