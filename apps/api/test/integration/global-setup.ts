import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    pgOwnerUrl: string;
    pgAppUrl: string;
    pgWorkerUrl: string;
    redisUrl: string;
    natsUrl: string;
    migrateOutput: string;
  }
}

const API_DIR = path.resolve(import.meta.dirname, '../..');
export const APP_PASSWORD = 'verbis_app_integration_pw';
export const WORKER_PASSWORD = 'verbis_worker_integration_pw';

/** Starts PostgreSQL 16, Redis 7 and NATS JetStream once for the whole integration run. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const [pg, redis, nats]: [
    StartedPostgreSqlContainer,
    StartedRedisContainer,
    StartedTestContainer,
  ] = await Promise.all([
    new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('verbis')
      .withUsername('verbis_owner')
      .withPassword('owner_integration_pw')
      .start(),
    new RedisContainer('redis:7-alpine').start(),
    new GenericContainer('nats:2.14-alpine')
      .withCommand(['--jetstream', '--http_port', '8222'])
      .withExposedPorts(4222, 8222)
      .withWaitStrategy(Wait.forHttp('/healthz?js-enabled-only=true', 8222))
      .start(),
  ]);

  const ownerUrl = pg.getConnectionUri();
  const env = {
    ...process.env,
    DATABASE_URL: ownerUrl,
    DATABASE_APP_PASSWORD: APP_PASSWORD,
    DATABASE_AUDIT_WORKER_PASSWORD: WORKER_PASSWORD,
  };
  // The acceptance criterion: migrations apply cleanly to an empty database.
  const migrateOutput = execFileSync(
    path.join(API_DIR, 'node_modules/.bin/prisma'),
    ['migrate', 'deploy'],
    { cwd: API_DIR, env, encoding: 'utf8' },
  );
  execFileSync(path.join(API_DIR, 'node_modules/.bin/tsx'), ['scripts/db-app-role.ts'], {
    cwd: API_DIR,
    env,
    encoding: 'utf8',
  });

  const appUrl = new URL(ownerUrl);
  appUrl.username = 'verbis_app';
  appUrl.password = APP_PASSWORD;

  project.provide('pgOwnerUrl', ownerUrl);
  const workerUrl = new URL(ownerUrl);
  workerUrl.username = 'verbis_audit_worker';
  workerUrl.password = WORKER_PASSWORD;

  project.provide('pgAppUrl', appUrl.toString());
  project.provide('pgWorkerUrl', workerUrl.toString());
  project.provide('redisUrl', redis.getConnectionUrl());
  project.provide('natsUrl', `nats://${nats.getHost()}:${String(nats.getMappedPort(4222))}`);
  project.provide('migrateOutput', migrateOutput);

  return async () => {
    await Promise.all([pg.stop(), redis.stop(), nats.stop()]);
  };
}
