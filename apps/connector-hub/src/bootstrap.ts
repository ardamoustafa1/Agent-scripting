import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { registerHttpMetrics } from '@verbis/observability';

import { AppModule, type HubOverrides } from './app.module.js';
import { createFastifyAdapterOptions } from './fastify-options.js';

import type { HubEnv } from './env.js';

const MAX_BODY_BYTES = 1_048_576;

/** Builds the hub. JSON bodies keep their raw bytes: webhook HMACs are computed over them. */
export async function createHub(
  env: HubEnv,
  overrides: HubOverrides = {},
  logger = true,
): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    ...createFastifyAdapterOptions(env.LOG_LEVEL),
    bodyLimit: MAX_BODY_BYTES,
  });
  const fastify = adapter.getInstance();
  registerHttpMetrics(fastify);
  fastify.removeContentTypeParser('application/json');
  adapter.useBodyParser(
    'application/json',
    true,
    { bodyLimit: MAX_BODY_BYTES },
    (request, body, done) => {
      const raw = body;
      request.rawBody = raw;
      if (raw.length === 0) {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(raw.toString('utf8')) as unknown);
      } catch {
        // Webhooks verify the signature first; other routes see `undefined` and fail validation.
        done(null, undefined);
      }
    },
  );
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(env, overrides),
    adapter,
    logger ? {} : { logger: false },
  );
  app.enableShutdownHooks();
  return app;
}
