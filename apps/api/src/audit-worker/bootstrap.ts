import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { createLogger, PinoNestLogger } from '../common/logging/logger.js';

import { AuditWorkerModule } from './audit-worker.module.js';

import type { ApiEnv } from '../env.js';
import type { INestApplicationContext } from '@nestjs/common';

export async function createWorker(env: ApiEnv): Promise<INestApplicationContext> {
  const logger = createLogger(env.LOG_LEVEL);
  const app = await NestFactory.createApplicationContext(AuditWorkerModule.forRoot(env), {
    logger: new PinoNestLogger(logger),
  });
  app.enableShutdownHooks();
  await app.init();
  return app;
}
