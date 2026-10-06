import { createServer, type Server } from 'node:http';

import { DatabaseProbe } from '../infra/database/prisma.service.js';
import { MessagingProbe } from '../infra/nats/nats.service.js';
import { CacheProbe } from '../infra/redis/redis.service.js';

import type { INestApplicationContext } from '@nestjs/common';

/** Dependency failures remove workers from readiness; they never trigger liveness restarts. */
export function createWorkerHealthServer(app: INestApplicationContext): Server {
  const checks = [app.get(DatabaseProbe), app.get(CacheProbe), app.get(MessagingProbe)];
  return createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'GET') {
      response.writeHead(405).end();
      return;
    }
    if (request.url === '/health/live') {
      response.end('{"status":"ok"}');
      return;
    }
    if (request.url !== '/health/ready') {
      response.writeHead(404).end();
      return;
    }
    const timer = setTimeout(() => {
      response.writeHead(503).end('{"status":"error"}');
    }, 2500);
    void Promise.all(checks.map((check) => check.ping())).then(
      () => {
        clearTimeout(timer);
        if (!response.writableEnded) response.end('{"status":"ok"}');
      },
      () => {
        clearTimeout(timer);
        if (!response.writableEnded) response.writeHead(503).end('{"status":"error"}');
      },
    );
  });
}
