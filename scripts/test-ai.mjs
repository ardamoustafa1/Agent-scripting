import { spawnSync } from 'node:child_process';
// Explicit opt-in only; never called by build/generation/typecheck.
const integration = process.argv.includes('--integration'),
  e2e = process.argv.includes('--e2e');
const args = e2e
  ? ['--filter', '@verbis/designer-web', 'exec', 'playwright', 'test', 'e2e/ai.spec.ts']
  : [
      '--filter',
      '@verbis/api',
      'exec',
      'vitest',
      'run',
      '--project',
      integration ? 'integration' : 'unit',
      integration ? 'test/integration/ai.int.spec.ts' : 'src/modules/ai',
    ];
const result = spawnSync('pnpm', args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
