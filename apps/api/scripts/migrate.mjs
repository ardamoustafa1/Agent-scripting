import { spawn } from 'node:child_process';

import pg from 'pg';

const ownerUrl = process.env.DATABASE_URL;
if (!ownerUrl) throw new Error('DATABASE_URL must be supplied only to the migration job');
const lock = new pg.Client({ connectionString: ownerUrl, application_name: 'verbis-migration' });
let activeChild;
let lockLost = false;
lock.on('error', () => {
  lockLost = true;
  activeChild?.kill('SIGTERM');
});
function run(args) {
  if (lockLost) throw new Error('Migration lock connection lost');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit', env: process.env });
    activeChild = child;
    const stop = () => child.kill('SIGTERM');
    process.once('SIGTERM', stop);
    child.once('error', reject);
    child.once('exit', (code) => {
      process.removeListener('SIGTERM', stop);
      activeChild = undefined;
      if (code === 0 && !lockLost) resolve();
      else reject(new Error('Migration command failed'));
    });
  });
}
try {
  await lock.connect();
  await lock.query("SET statement_timeout = '10min'");
  await lock.query("SELECT pg_advisory_lock(hashtextextended('verbis-schema-migration', 0))");
  await run(['node_modules/prisma/build/index.js', 'migrate', 'deploy']);
  await run(['--import', 'tsx', 'scripts/db-app-role.ts']);
} catch {
  // Driver errors may contain connection details; never print owner credentials.
  process.stderr.write('Migration failed; inspect database/migration status securely\n');
  process.exitCode = 1;
} finally {
  await lock.end().catch(() => undefined);
}
