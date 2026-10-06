# Expand/contract and traffic rollout

These are operator-run examples, not executed rollout evidence.

1. Expand with nullable/new columns, compatible indexes and additive APIs/events. Large indexes
   use independently reviewed `CREATE INDEX CONCURRENTLY` SQL outside transaction-wrapped steps;
   set lock/statement timeouts, monitor locks and cancel safely. Do not append destructive SQL to
   an expand release. PostgreSQL extensions/role bootstrap require managed-service permissions.
2. Run the matching migration image; the chart pre-upgrade hook serializes with a PostgreSQL
   advisory lock. Prisma migrate deploy executes committed migrations only; it never seeds.
3. Roll API/web/worker pods with maxUnavailable 0, readiness and 90-second termination grace.
   Preserve compatible event/session/package formats and idempotency across versions. Existing
   WebSockets can disconnect on pod replacement; clients reconnect through the secure flow.
   Accept queue draining and reconnect behavior in staging before claiming zero downtime.
4. Backfill through tenant-scoped resumable audited work, then verify old/new readers and queues.
5. Contract in a later release only after all old pods, messages, workers and rollback readers
   have retired. Obtain a new backup before removing old columns. No automatic down migration.

For a 5% canary, first apply expand to the stable release. Use the same site overlay/hosts/secrets,
then a distinct release with `deploy/examples/values-green.yaml` (shared DB/Redis/NATS, stable
hub/document owner routes, no duplicate migration/audit worker/internal ingress):

```sh
helm upgrade --install verbis-green deploy/helm/verbis -n verbis \
  -f /secure/site.yaml -f deploy/examples/values-green.yaml --wait --timeout 20m
# After acceptance, increase nginx ingress canary-weight: 5 → 25 → 50 → 100.
# For blue-green, hold weight 0, verify private candidate ingress, then switch to 100.
# For rollback before contract, set weight 0; leave compatible expanded schema intact.
```

Use exact stable release service names in `routing` if the stable release is not `verbis`.
Keep real release digests in the site overlay; values-green does not invent candidate artifacts.
Separate releases cannot automatically share an ingress on every controller; this example relies
on ingress-nginx canary behavior and must be accepted on the chosen controller.
Monitor API RED, launch rejections, active sessions, write-back backlog, connector lag, breaker
state and audit verification; record target/check duration and explicit rollback thresholds.
Promote only after critical acceptance, backup/restore evidence and SLO burn are reviewed.
Stateful connector/document owners remain Recreate and require planned reconnect/shard drain;
automatic leader election and uninterrupted failover for them are not implemented.
