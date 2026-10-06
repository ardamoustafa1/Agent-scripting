await import('./telemetry.js');
const { createHub } = await import('./bootstrap.js');
const { loadHubEnv } = await import('./env.js');

async function bootstrap(): Promise<void> {
  const env = loadHubEnv();
  const app = await createHub(env);
  await app.listen({ port: env.CONNECTOR_HUB_PORT, host: env.CONNECTOR_HUB_HOST });
}

bootstrap().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
