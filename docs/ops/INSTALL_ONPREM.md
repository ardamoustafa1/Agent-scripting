# Verbis on-premises / air-gapped installation

Deployment code is authored, not release-certified. No tests, image builds, Helm rendering,
cluster installation, migration or restore drill were executed in this session. Replace all
example domains, image digests and references with reviewed site configuration before use.

## Topology and prerequisites

Use Kubernetes 1.29+, a CNI that enforces NetworkPolicy, metrics-server, an ingress controller
supporting the selected annotations, TLS certificates, private registry and secret store.
The shipped ingress overlay targets ingress-nginx; validate and pin the controller distribution
approved by your organization. Its annotations are not portable to other controllers.
Install External Secrets v1 CRDs/controller first when enabled; no plaintext secret values go in
Helm values. Separate API, audit-worker, migration-owner and hub secrets. Check `.env.example`
and `apps/api/src/env.ts` / hub env schema for the complete key inventory.

All application images are multi-stage and non-root. API and audit worker share the distroless
API image (worker entrypoint `dist/audit-worker.js`). Three web images use unprivileged nginx;
Java adapters use numeric UID 10001. The migration target includes Prisma/tsx tooling and the
pruned API workspace; tooling is absent from the distroless runtime image. Licensed Java SDKs
must be supplied through a private, approved build process; default CI sidecars contain the
replay implementation and are disabled by default in Helm. Enable live source only in a
licensed build after connector contract acceptance.

## Dependencies: managed or in-cluster

| Dependency | Managed option | On-premises option |
| --- | --- | --- |
| PostgreSQL 16 | RDS Multi-AZ / Azure Database HA with PITR | CloudNativePG, three zone-separated instances, Barman Cloud plugin |
| Redis | TLS primary endpoint, e.g. managed Redis/ElastiCache in compatible non-sharded mode | Sentinel/operator or reviewed Bitnami chart plus HAProxy writable-primary endpoint |
| NATS | Authenticated managed JetStream | Official NATS Helm chart, three servers, PVCs and zone separation |
| Audit archive | Region-local S3 Object Lock | S3-compatible WORM storage with independently tested lock/retention semantics |

Application `REDIS_URL` currently expects one writable endpoint. Direct Sentinel discovery and
Redis Cluster routing are not implemented; do not point it at Sentinel port 26379 or a sharded
cluster. Queue Lua operations, leases and Socket.IO channels require compatibility verification.
PostgreSQL migrations use owner credentials only in the migration Job. Runtime `verbis_app` and
`verbis_audit_worker` remain least privilege with RLS; never run API with owner credentials.
Budget connections using 20 pool connections per process plus worker listeners, jobs and upgrade
surge; provision PgBouncer only after Prisma/RLS session/transaction behavior is verified.

Dependency operators/charts are separate releases so data lifecycle survives application rollback.
`deploy/examples/dependencies.yaml` contains a starting topology. Approved operator CRs may also
be provided through chart `dependencyResources`; CRDs, dependency namespaces, backup credentials
and operators must exist first. No subcharts are downloaded by the application chart. Pin and
package reviewed dependency chart versions yourself; chart credentials/licensing availability
can differ between vendors. Do not automatically remove data CRs on application uninstall.
NATS server clustering alone does not replicate existing streams: set `NATS_STREAM_REPLICAS=3`
(or 5 with five servers), inspect every stream and set licensed sidecar streams to the same
replication policy. [NATS cluster documentation](https://docs.nats.io/learn/topologies/jetstream-in-a-cluster).

## HA and routing

API, audit worker and the three web apps default to two replicas, HPA, PDB, spread constraints,
resource limits, read-only roots, emptyDir scratch space and dependency-aware readiness.
HPA requires metrics-server; PDB covers voluntary disruptions, not arbitrary node loss.
Hub/vendor sidecars own long-lived vendor connections; the collaboration process owns fenced
Hocuspocus document rooms. They use one replica and Recreate to prevent simultaneous owners.
Scale these by disjoint tenant/connector shards in separate cells/releases. Automatic leader
failover and shared multi-node collaboration are outstanding implementation/acceptance work;
this chart does not promise uninterrupted deployment for those owners.

Web nginx forwards `/api/` to API with the prefix removed, `/socket.io/` to API and
`/collaboration` to its dedicated process. No cookie affinity is configured. Runtime uses
websocket-only transport plus Redis fan-out; reconnects must be accepted against staging before
release. [Socket.IO multi-node guidance](https://socket.io/docs/v4/using-multiple-nodes/).
API instances disable local collaboration and use the stable collaboration service for flushes.

The private API ingress requires client-certificate verification and sends `ssl-client-cert` to
API; hub verifies the server CA and supplies its mounted cert/key. Public web proxies erase that
header. Set `MTLS_CLIENT_CERT_HEADER=ssl-client-cert` only behind this controlled ingress, preserve
NetworkPolicy, and verify forged-header rejection. Provision `verbis-client-ca` (`ca.crt`),
`verbis-internal-tls`, public TLS secret, and `verbis-hub-mtls` (`client.crt`, `client.key`, `ca.crt`).
Allow the private ingress path from hub explicitly. Configure hub service clients per tenant;
certificates alone do not create tenant authorization. API→hub calls still require trusted JWKS.

## Initial install and upgrades

1. Provision dependency releases and wait for PostgreSQL/Redis/NATS readiness; provision regional
   archive storage and backups before production traffic.
2. Create the application namespace, TLS/mTLS secrets and env secrets. If using ESO, materialize
   ExternalSecrets first (`helm template ... --show-only templates/external-secrets.yaml` and
   apply that output), then wait for their Ready condition. Extend the example mapping to ALL
   required keys; first-install jobs must not wait on missing env secrets.
3. Create private `site.yaml`: real image repositories with `sha256:` digests for each enabled
   service and migration, real TLS hosts, secret names, app origins and `PUBLIC_API_URL`.
   Production rejects mutable tags and stateless replicas below two. Use separate reviewed
   CIDR/port egress rules for DB/cache/NATS, private ingress, IdPs, vendor CTI, integrations, S3,
   SMTP and telemetry. Egress is denied unless allowed; no automatic internet escape hatch.
4. Execute only when authorized:

```sh
helm upgrade --install verbis deploy/helm/verbis -n verbis \
  -f /secure/site.yaml --wait --wait-for-jobs --timeout 20m
```

First install creates a regular bounded migration Job; dependency readiness is a prerequisite.
On upgrades, the pre-upgrade hook completes migrations before application rollout. Keep migration
image and API image from the same release. Failed migrations block rollout. Preserve diagnostics
without printing environment variables. Do not seed demo users/data into production.

## Offline bundle

The connected export host needs Python 3.12+, skopeo, Helm and a pinned Cosign binary. The offline
host needs the same tools plus authenticated access to its local registry. Transfer/pin tool
binaries and trust roots through your approved process. No package manager or Helm repo access
is required on the offline host. Bundle every operator, init, monitoring and dependency image,
not just the eight application artifacts; populate `deploy/examples/images.json` with real digests.
The import preserves OCI manifest digests for all architectures, rather than Docker save/load.

```sh
# Connected export: publisher key OR exact CI certificate identity/issuer.
export COSIGN_CERTIFICATE_IDENTITY='https://github.com/ORG/REPO/.github/workflows/release-images.yml@refs/tags/vX.Y.Z'
export COSIGN_OIDC_ISSUER='https://token.actions.githubusercontent.com'
export EXPORT_SIGNING_KEY=/secure/bundle.key
export DEPENDENCY_CHART_DIR=/approved/charts
./deploy/scripts/export-airgap.sh /approved/images.json /transfer/verbis-release
# Offline: use a separately distributed trusted export public key.
export EXPORT_PUBLIC_KEY=/secure/bundle.pub
export OFFLINE_CHART_DIR=/approved/offline-charts
./deploy/scripts/import-airgap.sh /transfer/verbis-release.tar
helm upgrade --install verbis /approved/offline-charts/verbis-0.1.0.tgz \
  -n verbis -f /secure/site.yaml --wait --wait-for-jobs --timeout 20m
```

Use a separate inventory/bundle for each approved publisher identity or public-key policy;
operator/dependency images need their own verified publisher policy rather than the application
workflow identity. Export verifies source signatures before copying, signs the entire image/chart/inventory archive,
and includes source verification records. Import verifies the archive before safe extraction.
This trusts the reviewed export signer to bind source verification to transported artifacts.
If registry admission requires local image signatures, provide `DESTINATION_SIGNING_KEY` on the
import host, configure admission with its public key, and verify each imported digest. Source
registry signature objects are not copied automatically. CI uses GitHub OIDC identity signing;
verify exact release workflow identity and issuer. [Cosign verification](https://docs.sigstore.dev/cosign/verifying/verify/).

## Small-scale Compose

`deploy/compose.production.yaml` runs the same seven processes against externally provisioned
PostgreSQL/Redis/NATS/archive. It is a single-host option, without HA/HPA/PDB. If local dependencies
are needed, provision the existing root development Compose services on a private network with
site-owned credentials/persistent backup policy; those development defaults are not production
HA. Export digest-pinned `API_IMAGE`, `CONNECTOR_HUB_IMAGE`, `MIGRATION_IMAGE`, `ADMIN_WEB_IMAGE`,
`DESIGNER_WEB_IMAGE`, `AGENT_WEB_IMAGE` and `VERBIS_SECRET_DIR` (mode 0700, env files mode 0600).

```sh
docker compose -f deploy/compose.production.yaml --profile migration run --rm migration
docker compose -f deploy/compose.production.yaml up -d
```

A site TLS reverse proxy forwards approved hostnames to loopback 8081/8082/8083, preserves Host,
supports WebSockets, terminates/verifies hub mTLS on a private route, and removes client certificate
headers on public routes. Set origins to those HTTPS hostnames; never disable secure cookies.
Compose does not change kernel/firewall policy or expose DB/Redis/NATS on the host.

## Residency cells

Deploy one release/data plane per permitted region; label and pin nodes by residency policy using
`placement.nodeSelector`, separate region-local DB/cache/NATS/object buckets/KMS and OTLP sinks.
A region label alone does not pin pods or restrict data placement. Use cell-local IdPs/integration
allow lists, retention and backups. Map tenants to a home cell before authentication/launch and
reject cross-cell routing. Tenant-specific releases/databases give stronger isolation; shared
cell databases retain RLS. Shared schema has no built-in arbitrary per-tenant database router:
tenant migration requires an explicit audited export/import plan. Cross-region replication is
opt-in after legal approval; cold/warm DR within allowed geography is preferable to unsupported
active-active writes. See [DR.md](DR.md) and [ROLLOUT.md](ROLLOUT.md).

### Shared proof for forwarded mTLS

Provision a random `MTLS_PROXY_SECRET` of at least 32 characters in the API environment Secret
and the verified private TLS edge. If using ingress-nginx, set
`internalIngress.proxyHeadersConfigMap` to the operator-managed map injecting
`x-verbis-mtls-proxy-secret`; restrict access to its value and never commit it.
The edge must overwrite incoming proof/certificate headers after successful certificate validation.
Without this proof, token grants and certificate-bound bearer requests fail closed.
Public nginx routes strip the proof and certificate. Development bootstrap provisions its own proof.
For opt-in customer-network SQL/HTTP access, follow [private egress setup](../integrations/PRIVATE_EGRESS.md).
