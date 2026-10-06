/**
 * Enables LOGIN for the least-privilege runtime role created by the migrations, with the password
 * from DATABASE_APP_PASSWORD. Runs with the owner connection (DATABASE_URL). Idempotent.
 */
import path from 'node:path';

import { config as loadDotenv } from 'dotenv';
import pg from 'pg';

loadDotenv({ path: path.resolve(import.meta.dirname, '../../../.env'), quiet: true });

const ownerUrl = process.env['DATABASE_URL'];
const password = process.env['DATABASE_APP_PASSWORD'];
if (ownerUrl === undefined || password === undefined || password.length < 12) {
  process.stderr.write('DATABASE_URL and DATABASE_APP_PASSWORD (>= 12 chars) are required\n');
  process.exit(1);
}

const client = new pg.Client({ connectionString: ownerUrl });
await client.connect();
try {
  // ALTER ROLE cannot take bind parameters; format(%L) quotes the literal safely.
  const { rows } = await client.query<{ sql: string }>(
    "SELECT format('ALTER ROLE verbis_app LOGIN PASSWORD %L', $1::text) AS sql",
    [password],
  );
  const sql = rows[0]?.sql;
  if (sql === undefined) throw new Error('could not build statement');
  await client.query(sql);
  process.stdout.write('verbis_app login enabled\n');

  // Audit worker role (ADR-0014): separate least-privilege login, only when configured.
  const workerPassword = process.env['DATABASE_AUDIT_WORKER_PASSWORD'];
  if (workerPassword !== undefined && workerPassword !== '') {
    if (workerPassword.length < 12)
      throw new Error('DATABASE_AUDIT_WORKER_PASSWORD must be >= 12 chars');
    const worker = await client.query<{ sql: string }>(
      "SELECT format('ALTER ROLE verbis_audit_worker LOGIN PASSWORD %L', $1::text) AS sql",
      [workerPassword],
    );
    const workerSql = worker.rows[0]?.sql;
    if (workerSql === undefined) throw new Error('could not build statement');
    await client.query(workerSql);
    process.stdout.write('verbis_audit_worker login enabled\n');
  }
} finally {
  await client.end();
}
