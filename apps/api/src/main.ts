// Telemetry must load before any instrumented module (http, pg, ioredis, fastify), so the
// application is imported dynamically afterwards. Both specifiers are static.
await import('./telemetry.js');
const { loadApiEnv } = await import('./env.js');
const { createApp } = await import('./bootstrap.js');

try {
  // Fails fast with a readable list of problems if the environment is invalid.
  const env = loadApiEnv();
  const app = await createApp(env);
  await app.listen({ port: env.API_PORT, host: env.API_HOST });
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
