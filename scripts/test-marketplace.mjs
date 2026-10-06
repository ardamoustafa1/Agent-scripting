#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const flags = process.argv.slice(2);
if (flags.some((flag) => flag !== '--typecheck'))
  throw new Error('Usage: pnpm test:marketplace [--typecheck]');
const suites = [
  [
    '@verbis/sdk-connector',
    [
      'src/platforms/marketplace',
      'src/platforms/agent-event-poller',
      'src/platforms/amazon-contact-events',
    ],
  ],
  [
    '@verbis/connector-hub',
    [
      'src/connectors/marketplace',
      'src/connectors/amazon-connect',
      'src/connectors/cisco-webex',
      'src/connectors/cisco-finesse',
      'src/connectors/nice-cxone',
      'src/connectors/five9',
      'src/connectors/twilio-flex',
      'src/connectors/salesforce',
      'src/connectors/dynamics-365',
    ],
  ],
];
for (const [pkg, paths] of suites) {
  if (flags.includes('--typecheck')) {
    const result = spawnSync('pnpm', ['--filter', pkg, 'typecheck'], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(1);
  }
  const result = spawnSync('pnpm', ['--filter', pkg, 'exec', 'vitest', 'run', ...paths], {
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(1);
}
