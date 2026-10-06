// Explicit opt-in runner. No test is run by installing or building this change.
import { spawnSync } from 'node:child_process';
const groups = {
  unit: [
    [
      '--filter',
      '@verbis/script-schema',
      'exec',
      'vitest',
      'run',
      'src/validation/consent-security.spec.ts',
    ],
    ['--filter', '@verbis/ui', 'exec', 'vitest', 'run', 'src/security.spec.tsx'],
    ['--filter', '@verbis/sdk-component', 'exec', 'vitest', 'run', 'src/security.spec.ts'],
    ['--filter', '@verbis/components', 'exec', 'vitest', 'run', 'src/privacy-security.spec.tsx'],
    [
      '--filter',
      '@verbis/api',
      'exec',
      'vitest',
      'run',
      'src/common/http/rate-limit.spec.ts',
      'src/common/http/json-security.spec.ts',
      'src/modules/runtime/security.spec.ts',
      'src/modules/runtime/runtime-cipher.spec.ts',
      'src/modules/identity/session/session-cookie.spec.ts',
      'src/modules/analytics/session.consumer.spec.ts',
      'src/modules/runtime/runtime-state.store.spec.ts',
    ],
  ],
  headers: [
    [
      '--filter',
      '@verbis/agent-web',
      'exec',
      'playwright',
      'test',
      'e2e/security.spec.ts',
      '--project=security',
    ],
  ],
};
const group = process.argv[2] ?? 'unit';
if (!(group in groups))
  throw new Error('Use unit or headers (headers requires SECURITY_BASE_URL).');
if (group === 'headers' && !process.env.SECURITY_BASE_URL)
  throw new Error('SECURITY_BASE_URL is required for production header acceptance');
for (const args of groups[group]) {
  const result = spawnSync('pnpm', args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (group === 'headers') {
  const { readFile } = await import('node:fs/promises');
  const { assertTestResults } = await import('./assert-test-results.mjs');
  assertTestResults(
    JSON.parse(await readFile('apps/agent-web/test-results/results.json', 'utf8')),
    'playwright',
  );
}
