import { access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { loadQuarantine } from './flaky-policy.mjs';
await loadQuarantine();
const required = [
  'ADMIN_E2E_BASE_URL',
  'DESIGNER_E2E_BASE_URL',
  'AGENT_E2E_BASE_URL',
  'ADMIN_E2E_STORAGE_STATE',
  'AUDIT_E2E_FROM_SEQ',
  'AUDIT_E2E_TO_SEQ',
  'SAML_E2E_TENANT',
  'SAML_E2E_IDP_ID',
  'SAML_E2E_USERNAME',
  'SAML_E2E_PASSWORD',
  'SAML_E2E_IDP_ORIGIN',
  'DESIGNER_E2E_AUTHOR_STATE',
  'DESIGNER_E2E_PEER_STATE',
  'DESIGNER_E2E_SCRIPT_ID',
  'DESIGNER_E2E_DRAFT_NUMBER',
  'AGENT_E2E_CONNECTOR_ID',
  'AGENT_E2E_PLATFORM_USER',
  'AGENT_E2E_STORAGE_STATE',
  'AGENT_E2E_SESSION_ID',
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length)
  throw new Error(`Live acceptance cannot silently skip: missing ${missing.join(', ')}`);
for (const name of [
  'ADMIN_E2E_BASE_URL',
  'DESIGNER_E2E_BASE_URL',
  'AGENT_E2E_BASE_URL',
  'SAML_E2E_IDP_ORIGIN',
]) {
  const url = new URL(process.env[name]);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error(`${name} must use HTTPS outside loopback`);
}
for (const name of [
  'ADMIN_E2E_STORAGE_STATE',
  'DESIGNER_E2E_AUTHOR_STATE',
  'DESIGNER_E2E_PEER_STATE',
  'AGENT_E2E_STORAGE_STATE',
])
  await access(process.env[name]);
for (const [app, prefix] of [
  ['admin-web', 'ADMIN'],
  ['designer-web', 'DESIGNER'],
  ['agent-web', 'AGENT'],
]) {
  const result = spawnSync(
    'pnpm',
    [
      '--filter',
      `@verbis/${app}`,
      'exec',
      'playwright',
      'test',
      '--project=live',
      ...(app === 'agent-web' ? ['--project=performance'] : []),
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        E2E_LIVE: '1',
        AGENT_E2E_PERFORMANCE: '1',
        LIVE_BASE_URL: process.env[`${prefix}_E2E_BASE_URL`],
      },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = 1;
  else {
    const { assertTestResults } = await import('./assert-test-results.mjs');
    const { readFile } = await import('node:fs/promises');
    assertTestResults(
      JSON.parse(await readFile(`apps/${app}/test-results/results.json`, 'utf8')),
      'playwright',
    );
  }
}
