# Private egress / SQL first slice

## API and identity setup

1. Apply the migration adding `datasource_protocol.sql`.
2. Set `PRIVATE_EGRESS_ENABLED=true` on the API. Use the same `IDENTITY_ENCRYPTION_KEYS` on replicas; Redis is shared.
3. Create a dedicated tenant service client with `authMethod: "tls_client_auth"`, its worker certificate and `scopes: ["execute:Integration"]`. Do not share a CTI hub client. Only an administrator who holds the permission may delegate it.
4. Where TLS terminates at an edge, configure API `MTLS_CLIENT_CERT_HEADER` and a random `MTLS_PROXY_SECRET` of at least 32 characters. The verified TLS edge must overwrite the certificate header AND `x-verbis-mtls-proxy-secret` on every request. Public edges must strip both. The worker never receives the proxy secret. Direct TLS socket authentication remains available with an empty certificate-header setting.
5. For HTTP targets, set tenant `settings.integrationAllowedOrigins` and source `policy.allowedOrigins` to the exact private origin. Also grant `allowHttp` in both source and local target if deliberately using HTTP.

The Helm internal ingress can reference an operator-managed header ConfigMap with `internalIngress.proxyHeadersConfigMap`; ingress-nginx reads `x-verbis-mtls-proxy-secret` from that reference. Keep its value synchronized with the API Secret and restrict access to the ingress controller/operator. Never put the value in values files, source control or a public ingress header map. For an edge supporting secret-file configuration, prefer that mechanism. Missing edge proof fails authentication, including certificate-bound bearer token reuse.

## Worker configuration

Save a mode-0600 JSON config and provision separate mode-0600 secrets/TLS files on the customer host. Example (replace IDs and paths):

```json
{
  "apiOrigin": "https://api.internal.example.com",
  "tenantSlug": "customer",
  "clientId": "00000000-0000-4000-8000-000000000001",
  "certFile": "/run/verbis/worker.pem",
  "keyFile": "/run/verbis/worker.key",
  "caFile": "/run/verbis/api-ca.pem",
  "targets": {
    "crm-http": {
      "kind": "http",
      "origin": "https://crm.corp.example",
      "allowedCidrs": ["10.40.0.0/16"],
      "bearerTokenFile": "/run/verbis/crm-token",
      "caFile": "/run/verbis/corp-ca.pem"
    },
    "crm-db": {
      "kind": "postgres",
      "host": "db.corp.example",
      "allowedCidrs": ["10.41.0.0/16"],
      "credentialsFile": "/run/verbis/db.json",
      "caFile": "/run/verbis/db-ca.pem",
      "queries": {
        "customer-by-id": {
          "text": "SELECT id, status FROM approved_customer_view WHERE id = $1",
          "parameterCount": 1,
          "maxRows": 1
        }
      }
    }
  }
}
```

`db.json` contains `{ "database": "crm", "user": "verbis_reader", "password": "<provision separately>" }`. Use a dedicated SELECT-only account and audited view catalog. The schema cannot accept an inline password or connection string in a DataSource.

```sh
pnpm --filter @verbis/api start:private-egress /absolute/path/gateway.json
```

Install from the repository lockfile and supervise the worker on the customer host. It opens no inbound port. Network policy should permit only the configured API and local target networks. The first slice permits RFC1918 IPv4 targets; metadata/loopback/link-local/public/IPv6 targets are rejected even if the CIDR list is broad.

## SQL source

Create through `POST /v1/data-sources`:

```json
{
  "key": "customer-status",
  "protocol": "sql",
  "definition": {
    "baseUrl": "https://sql.invalid",
    "endpoint": "/query",
    "privateGateway": {
      "clientId": "00000000-0000-4000-8000-000000000001",
      "target": "crm-db"
    },
    "sql": { "queryKey": "customer-by-id", "parameters": ["customerId"] },
    "inputSchema": { "type": "object", "properties": { "customerId": { "type": "string" } }, "required": ["customerId"], "additionalProperties": false },
    "outputSchema": { "type": "array", "items": { "type": "object" } }
  },
  "policy": { "timeoutMs": 5000, "maxResponseBytes": 16384, "retries": 0, "containsPii": true }
}
```

The placeholder `baseUrl`/`endpoint` preserve the shared definition shape; SQL never connects to that URL. SQL does not need HTTP origin grants because the local catalog/target govern it. A browser sends only `{ "input": { "customerId": "synthetic-id" }, "environment": "test" }` to the sandbox test API. Runtime uses the existing BFF ownership/version-pin checks and server-selected environment. Private profiles cannot set API-side auth or response caching.

For REST/SOAP/GraphQL, use the actual private `baseUrl` and the same `privateGateway` field. Existing schema mapping, redaction and failure policies apply. Separate client/target aliases per environment when networks or credentials differ.
