// Audit worker process (ADR-0014): domain-event audit, checkpoints, SIEM delivery, partitions,
// WORM archive and retention. Runs as `verbis_audit_worker`; health-only HTTP surface.
const { startTelemetry } = await import('@verbis/observability');
startTelemetry('verbis-audit-worker');
const { loadApiEnv } = await import('./env.js');
const { createWorker } = await import('./audit-worker/bootstrap.js');
const { createWorkerHealthServer } = await import('./audit-worker/health.js');

try {
  const env = loadApiEnv();
  const app = await createWorker(env);
  const health = createWorkerHealthServer(app);
  health.listen(env.AUDIT_WORKER_HEALTH_PORT, '0.0.0.0');
  const stop = (): void => {
    health.close();
    void app.close().then(() => process.exit(0));
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
