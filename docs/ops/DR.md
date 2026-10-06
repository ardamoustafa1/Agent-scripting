# Backup and disaster recovery

Targets below are operational objectives, not measured guarantees. No restore drill was run.

| Data / scenario | RPO target | RTO target | Recovery path |
| --- | --- | --- | --- |
| PostgreSQL node/AZ loss | 0 for acknowledged synchronous writes | 5 minutes | Managed Multi-AZ/operator primary failover |
| PostgreSQL corruption/deletion | ≤ 5 minutes | ≤ 60 minutes | Base backup + continuous WAL PITR into a new cluster |
| Permitted regional disaster | ≤ 15 minutes | ≤ 4 hours | Approved-region replicated backup/WAL, isolated restore, controlled promotion |
| Audit archive | 0 for confirmed archived objects | ≤ 4 hours | Locked versioned objects plus metadata/checkpoint verification |
| Redis/session loss | Active sessions may be invalidated | ≤ 15 minutes | Restore writable endpoint, secure relaunch; never recreate launch grants from caller input |
| JetStream node loss | 0 for acknowledged R3 writes with quorum | ≤ 5 minutes | Three-node replicated streams/consumers; replay idempotent outbox |

RPO 0 requires a verified synchronous acknowledgement/quorum configuration; asynchronous replicas
and object-store replication do not provide it. PostgreSQL is authoritative for durable runtime,
write-back/outbox and audit state. Do not advertise recovery of ephemeral Redis state as zero-loss.

## PostgreSQL PITR

Managed: enable PITR with at least 35-day retention, encrypted snapshots/WAL, separate backup
administration, legal-region placement and automated backup failure/age alerts. Test provider
restore to a new instance/endpoint with the original PostgreSQL major version and extensions.

On-premises: three-instance CNPG topology plus Barman Cloud plugin. `deploy/examples/backup.yaml`
provides an ObjectStore, daily ScheduledBackup and plugin archiver patch. Fill in TLS endpoint,
regional bucket, secret references and approved digest-pinned PostgreSQL image before applying.
Continuous WAL plus base backups are both required. Alert if last archived WAL exceeds 5 minutes,
base backup age exceeds 26 hours or backup verification fails. Test your storage retention policy
against WAL/base-backup dependency chains. Keep drill recovery credentials read-only and separate
from the production archiver; restored drills must not write to the original backup prefix.
[CNPG Barman plugin configuration](https://cloudnative-pg.io/plugin-barman-cloud/docs/usage/).

## Audit archive and keys

Enable versioning and Object Lock COMPLIANCE on a dedicated S3-compatible bucket before archive
writes; match tenant retention/legal hold and verify read-back SHA-256/lock metadata. Database
partition drops remain gated by verified archives. Backup audit metadata, tenant retention,
chain heads/checkpoints and encryption/signing key versions together. Retain old verification
public keys and decryption keys in a separately backed-up secret/KMS system. Never place private
keys in OCI bundles, chart values, DR reports or database export artifacts. Audit archive storage
and PostgreSQL backup storage use separate principals, buckets and lifecycle policies.

## Isolated restore drill

Run monthly per residency cell and before major storage/key/schema changes. Provision a dedicated
`verbis-drill-*` namespace with `verbis.io/drill=true`, no ingress, deny external integrations/
SMTP/CTI/SIEM and a read-only ObjectStore credential. Install CNPG/plugin first.

```sh
export DRILL_NAMESPACE=verbis-drill-20261003
export RECOVERY_OBJECT_STORE=verbis-drill-readonly
export BACKUP_SERVER_NAME=verbis-postgres
export RECOVERY_TARGET_TIME=2026-10-03T08:00:00Z
export POSTGRES_IMAGE='registry.internal/postgres@sha256:REPLACE_WITH_APPROVED_DIGEST'
./deploy/scripts/restore-drill.sh /secure/drill.json
# Review generated recovery manifest; --apply creates only the isolated drill cluster.
./deploy/scripts/restore-drill.sh /secure/another-drill.json --apply
```

The script validates namespace/label/time/digest, creates a new recovery cluster, waits for Ready
and never promotes it. It is idempotence-safe by refusing to overwrite output or reuse an existing
restore cluster. Operator readiness is only step one: securely validate earliest/latest recovered
transactions against the requested target; compare counts/checksums; verify RLS as both runtime
roles, schemas and queue/outbox watermarks. Use the application audit verification path for every
tenant and compare archived checkpoints/object hashes, retention and public-key versions. Restore
keys before exercising encrypted integrations. Do not send notifications or vendor commands.

Record UTC incident-start, restore-start, database-ready, audit-verified and application-ready
instants, archive/WAL boundary, observed RPO/RTO and deviations in a restricted incident record.
Delete the isolated cluster/PVC after reviewed evidence; leave original archive intact.
Automatic audit acceptance/traffic promotion is deliberately outside this script.

## Failover / regional promotion

Fence old writers and CTI owners before changing DB endpoints or routing a tenant to DR. Restore
DB, keys and locked archive metadata in the approved region; bring up Redis and JetStream, ensure
stream/consumer replication and replay outbox with existing dedupe IDs. Reconcile in-flight
write-back with the upstream system before retries. Fail closed on ambiguous session/launch leases;
operators ask agents to relaunch through the secure workflow. Switch controlled DNS/traffic only
after schema/RLS/audit and critical browser acceptance; document custody and tenant routing.
Do not run two writable cells against one tenant or assume PostgreSQL active-active conflict
resolution. Cross-region archive/WAL replication requires explicit residency approval and measured
lag. Repatriation follows a separate fenced migration plan.
