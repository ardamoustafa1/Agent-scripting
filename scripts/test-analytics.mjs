import { spawnSync } from 'node:child_process';
// Explicit opt-in runner; not called by generation, build or typecheck.
const integration = process.argv.includes('--integration');
const args = integration
  ? [
      '--filter',
      '@verbis/api',
      'exec',
      'vitest',
      'run',
      '--project',
      'integration',
      'test/integration/analytics.int.spec.ts',
    ]
  : [
      '--filter',
      '@verbis/api',
      'exec',
      'vitest',
      'run',
      '--project',
      'unit',
      'src/modules/analytics',
    ];
const result = spawnSync('pnpm', args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
