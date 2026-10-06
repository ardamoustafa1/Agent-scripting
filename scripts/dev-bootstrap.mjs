import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { configureDevEnvironment, writeEnvironment } from './dev-environment.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
let env;
const run = (command, args, extra = {}) => {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env, ...extra },
  });
  if (result.error || result.status !== 0)
    throw new Error(`Dev bootstrap stage failed: ${command} ${args.join(' ')}`);
};
try {
  env = configureDevEnvironment(root);
  run('docker', ['compose', 'up', '-d']);
  run('docker', [
    'compose',
    'up',
    '-d',
    '--wait',
    '--wait-timeout',
    '180',
    'postgres',
    'redis',
    'nats',
    'keycloak',
  ]);
  run('pnpm', ['build']);
  run('pnpm', ['db:migrate']);
  const stateFile = new URL('../.dev/bootstrap.json', import.meta.url);
  run('pnpm', ['seed'], { DEV_BOOTSTRAP_METADATA_FILE: fileURLToPath(stateFile) });
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  if (!state.hub?.clientId || state.hub.slug !== 'verbis-dev')
    throw new Error('Dev seed did not register the mTLS service client');
  const tenants = JSON.parse(env.HUB_TENANTS);
  if (!Array.isArray(tenants)) throw new Error('HUB_TENANTS must be an array');
  writeEnvironment(root, {
    HUB_TENANTS: JSON.stringify([
      ...tenants.filter((entry) => entry.slug !== state.hub.slug),
      state.hub,
    ]),
  });
  writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  console.log(
    '[verbis] Bootstrap ready: simulator, mTLS hub, integration/package keys and analytics configured.',
  );
  console.log('[verbis] Run pnpm dev (API, mTLS edge, hub, audit worker and browser apps).');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
