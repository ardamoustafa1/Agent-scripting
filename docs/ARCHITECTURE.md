# Verbis Architecture (C4)

Related: [DOMAIN](DOMAIN.md) · [SCRIPT_MODEL](SCRIPT_MODEL.md) · [SECURITY](SECURITY.md) · [PROGRESS](PROGRESS.md) · [CLAUDE.md](../CLAUDE.md)

## 1. Principles

1. **Core first.** Three primitives — `Box` (layout/container), `Button` (action trigger), `WebService` (data source/integration) — form the kernel. Every screen component is a composition on top ([SCRIPT_MODEL](SCRIPT_MODEL.md)).
2. **Adapters at every edge.** CTI/channel platforms are reached only through `@verbis/sdk-connector` adapters ([ADR-0008](adr/0008-adapter-based-connectors.md)).
3. **Server owns secrets and trust.** Browser holds no tokens ([ADR-0004](adr/0004-bff-auth.md)) and no credentials; screens open only via secure launch ([SECURITY §4](SECURITY.md)).
4. **Events as the spine.** State changes publish events over NATS JetStream ([ADR-0005](adr/0005-nats-event-bus.md)); audit, analytics and realtime are consumers.
5. **Tenant isolation by construction.** `tenant_id` everywhere + PostgreSQL RLS + tenant-scoped crypto keys.
6. **Deploy anywhere.** Same containers run SaaS (Kubernetes, multi-AZ) and on-prem (Helm / docker-compose bundle).

## 2. Level 1 — System Context

```mermaid
flowchart LR
    agent["Agent<br/>(contact center user)"]
    designer["Script Designer<br/>/ Supervisor"]
    admin["Tenant / Platform Admin"]
    verbis["Verbis Platform<br/>agent scripting"]
    idp["Identity Providers<br/>OIDC / SAML / SCIM"]
    cti["CTI & Contact Platforms<br/>Genesys Cloud, Genesys Engage,<br/>Avaya AES/AXP/AACC, Amazon Connect,<br/>Cisco, NICE CXone, Five9, CTI-less"]
    biz["Customer Business Systems<br/>CRM, core banking, ticketing<br/>REST / SOAP / GraphQL"]
    siem["SIEM / Log Platform"]
    obs["Observability Stack<br/>Prometheus, Grafana, OTel"]

    agent -->|"uses scripts<br/>HTTPS"| verbis
    designer -->|"designs scripts"| verbis
    admin -->|"administers"| verbis
    verbis <-->|"SSO, provisioning"| idp
    cti <-->|"interaction events,<br/>call control, screen-pop"| verbis
    verbis -->|"server-side proxied calls"| biz
    verbis -->|"audit export"| siem
    verbis -->|"metrics, traces"| obs
```

## 3. Level 2 — Containers

```mermaid
flowchart TB
    subgraph clients["Browser clients"]
        agentweb["agent-web<br/>React runtime renderer"]
        designerweb["designer-web<br/>visual + flow designer"]
        adminweb["admin-web<br/>tenant admin"]
    end

    gw["api-gateway / BFF<br/>Fastify - sessions, CSRF,<br/>rate limit, routing"]

    subgraph services["Backend services - NestJS"]
        core["core-api<br/>tenants, users, campaigns,<br/>scripts, assignments"]
        rts["runtime-session-service<br/>launch, sessions, events, realtime"]
        ie["integration-engine<br/>web service proxy"]
        ch["connector-hub<br/>CTI and channel adapters"]
        audit["audit-service<br/>hash-chained log, export"]
        analytics["analytics<br/>aggregates, reports"]
    end

    subgraph data["Data plane"]
        pg[("PostgreSQL 16<br/>RLS multi-tenant")]
        redis[("Redis<br/>cache, one-time tokens,<br/>presence, rate limits")]
        nats{{"NATS JetStream<br/>event bus"}}
        s3[("MinIO / S3<br/>assets, exports")]
        bull["BullMQ<br/>jobs on Redis"]
    end

    ext_idp["IdPs OIDC/SAML"]
    ext_cti["CTI platforms"]
    ext_biz["Business systems"]
    ext_siem["SIEM"]

    agentweb --> gw
    designerweb --> gw
    adminweb --> gw
    gw --> core
    gw --> rts
    gw --> ie
    gw --> audit
    gw --> analytics
    gw <--> ext_idp

    core --> pg
    rts --> pg
    rts --> redis
    ie --> redis
    ie --> ext_biz
    ch <--> ext_cti
    ch --> rts
    ch --> nats
    core --> nats
    rts --> nats
    ie --> nats
    nats --> audit
    nats --> analytics
    audit --> pg
    audit --> s3
    audit --> ext_siem
    analytics --> pg
    core --> s3
    core --> bull
    audit --> bull
```

### Container responsibilities

> Containers are logical boundaries. [ADR-0009](adr/0009-workspace-layout.md) maps them to workspaces: core-api, runtime-session-service, integration-engine, audit-service and analytics start as modules of `apps/api` and are extracted later.

| Container | Responsibility | Owns data |
|---|---|---|
| **api-gateway / BFF** (runs in `apps/api` `modules/identity` until extracted, [ADR-0012](adr/0012-identity-module.md)) | OIDC/SAML login termination, httpOnly SameSite session cookies, CSRF, CORS, rate limiting, request signing to internal services, tenant resolution (host/subdomain), SSE/WebSocket fan-in | session store (Redis) |
| **core-api** | Tenants, users, roles, IdPs, SCIM endpoints, campaigns, scripts, versions, assignments, variables, secrets metadata, designer collaboration backend | Postgres core schema |
| **runtime-session-service** | Launch intent issue/redeem, runtime sessions, session events, variable state, multi-channel concurrent sessions, assignment resolution at launch | sessions, events |
| **integration-engine** | Executes `WebService` calls (REST/SOAP/GraphQL), secret injection, SSRF guard, caching, retries, circuit breaker, response mapping/redaction | request logs (redacted), cache |
| **connector-hub** | Hosts adapters, normalizes platform events to Verbis `InteractionEvent`, exposes commands (hold, transfer, disposition) back to platform | connector config, adapter state |
| **audit-service** | Consumes audit events, appends hash chain, search API, verify API, SIEM export (syslog/CEF/JSON, S3, webhook) | audit store |
| **analytics** | Consumes session events, aggregates (script usage, outcomes, A/B), reports | analytics schema |
| **designer-web** | Drag-drop screen designer, flow designer, rule builder, visual debugger, diff, real-time co-editing UI | — |
| **agent-web** | Runtime renderer for scripts; embedded in CTI client (iframe/side panel) or standalone | — |
| **admin-web** | Tenant admin: users, roles, IdPs, SCIM, connectors, secrets, audit explorer, SIEM config | — |

## 4. Level 3 — Components

### 4.1 core-api

```mermaid
flowchart LR
    subgraph coreapi["core-api"]
        ctrl["HTTP controllers<br/>+ OpenAPI"]
        authz["AuthZ guard<br/>CASL RBAC+ABAC"]
        tenantmw["Tenant context<br/>RLS tx scope"]
        scriptsvc["Script service<br/>draft, publish, version"]
        validator["Script validator<br/>zod + semantic checks"]
        assign["Assignment engine<br/>many-to-many, priority,<br/>validity, rules"]
        campsvc["Campaign service"]
        idsvc["Identity admin<br/>IdPs, SCIM"]
        secretsvc["Secret service<br/>envelope encryption"]
        collab["Collaboration hub<br/>CRDT sync"]
        outbox["Outbox publisher<br/>to NATS"]
        repo["Prisma repositories"]
    end
    ctrl --> authz --> tenantmw
    tenantmw --> scriptsvc
    tenantmw --> campsvc
    tenantmw --> assign
    tenantmw --> idsvc
    tenantmw --> secretsvc
    scriptsvc --> validator
    scriptsvc --> repo
    campsvc --> repo
    assign --> repo
    idsvc --> repo
    secretsvc --> repo
    collab --> repo
    repo --> outbox
```

### 4.2 integration-engine

<a id="integration-engine"></a>

```mermaid
flowchart LR
    req["Execute request<br/>from runtime or designer test"] --> auth["Session + tenant check"]
    auth --> resolve["DataSource resolver<br/>load versioned definition"]
    resolve --> expr["Input mapping<br/>safe expression engine"]
    expr --> ssrf["SSRF guard<br/>DNS pin, IP deny-list,<br/>allow-list, no redirects to private"]
    ssrf --> sec["Secret injector<br/>auth headers, mTLS, OAuth2 CC"]
    sec --> proto{"Protocol"}
    proto --> rest["REST driver"]
    proto --> soap["SOAP driver<br/>WSDL + WS-Security"]
    proto --> gql["GraphQL driver<br/>persisted/allow-listed ops"]
    rest --> resil["Resilience<br/>timeout, retry, breaker, bulkhead"]
    soap --> resil
    gql --> resil
    resil --> map["Response mapping<br/>+ PII redaction + size limit"]
    map --> cache["Cache - Redis"]
    map --> out["Result to caller"]
```

### 4.3 runtime-session-service

```mermaid
flowchart LR
    subgraph rts["runtime-session-service"]
        intent["Launch intent issuer"]
        redeem["Launch redeemer<br/>one-time, bound, short-lived"]
        resolver["Script resolver<br/>assignment match"]
        sess["Session manager<br/>multi-channel concurrent"]
        state["Variable state store"]
        evt["Session event recorder"]
        rt["Realtime push<br/>SSE/WebSocket"]
        cmd["Platform command bridge"]
    end
    intent --> redeem --> resolver --> sess
    sess --> state
    sess --> evt
    sess --> rt
    sess --> cmd
    cmd --> hub["connector-hub"]
    evt --> bus{{"NATS"}}
```

### 4.4 connector-hub

```mermaid
flowchart LR
    subgraph hub["connector-hub"]
        reg["Adapter registry"]
        life["Adapter lifecycle<br/>health, reconnect, rate-limit"]
        norm["Event normalizer<br/>to InteractionEvent"]
        cmdr["Command router<br/>hold, transfer, wrap-up"]
        subgraph adapters["Adapters - sdk-connector"]
            gc["Genesys Cloud"]
            ge["Genesys Engage - no WDE"]
            av["Avaya AES / AXP / AACC"]
            ac["Amazon Connect"]
            ci["Cisco"]
            nx["NICE CXone"]
            f9["Five9"]
            nc["Generic / CTI-less"]
        end
    end
    reg --> life
    life --> adapters
    adapters --> norm --> bus{{"NATS + runtime-session"}}
    cmdr --> adapters
```

### 4.5 Front-end structure

```mermaid
flowchart TB
    subgraph web["Front-end layering"]
        apps["designer-web / agent-web / admin-web"]
        comps["@verbis/components<br/>screen components"]
        prim["@verbis/core-runtime<br/>Box - Button - WebService"]
        ds["@verbis/ui<br/>tokens, Radix, themes"]
        sch["@verbis/script-schema + @verbis/expr"]
    end
    apps --> comps --> prim --> ds
    prim --> sch
    comps --> sch
```

## 5. Key runtime flows

### 5.1 Secure launch (summary; full design in [SECURITY §4](SECURITY.md))

```mermaid
sequenceDiagram
    autonumber
    participant CTI as CTI Platform
    participant CH as connector-hub
    participant RTS as runtime-session-service
    participant GW as BFF
    participant AW as agent-web
    CTI->>CH: interaction event (alerting/connected)
    CH->>RTS: create launch intent (tenant, interaction, agent identity)
    RTS-->>CH: intent id
    RTS->>GW: push to authenticated agent channel (SSE)
    GW->>AW: launch handle (never in URL)
    AW->>GW: POST /launch/redeem (cookie + CSRF)
    GW->>RTS: redeem (user, session, device binding)
    RTS->>RTS: verify sig, exp, jti single-use, bindings
    RTS-->>GW: runtime session id + resolved script version
    GW-->>AW: session bootstrap (no secrets)
    AW->>GW: load script, stream session events
```

### 5.2 WebService call from a screen

```mermaid
sequenceDiagram
    autonumber
    participant UI as agent-web (Button click)
    participant GW as BFF
    participant IE as integration-engine
    participant BIZ as Business system
    UI->>GW: POST /v1/runtime/sessions/{id}/data-sources/{dsId}/execute {inputs}
    GW->>IE: signed internal call (tenant, session, user)
    IE->>IE: authorize, map inputs, SSRF guard, inject secrets
    IE->>BIZ: REST / SOAP / GraphQL
    BIZ-->>IE: response
    IE->>IE: redact, map, size-limit, cache
    IE-->>UI: mapped result only
    IE-)NATS: datasource.executed event (redacted)
```

### 5.3 Audit pipeline

```mermaid
flowchart LR
    tx["Domain transaction"] --> ob[("Outbox table")]
    ob --> pub["Outbox publisher"]
    pub --> bus{{"NATS JetStream<br/>audit stream"}}
    bus --> as["audit-service<br/>sequencer"]
    as --> chain["Hash chain per tenant<br/>h = SHA-256 of prev_hash + canonical event"]
    chain --> store[("Append-only store")]
    chain --> anchor["Periodic anchor<br/>signed checkpoint to S3 WORM"]
    store --> search["Search API"]
    store --> exp["SIEM exporter<br/>CEF / JSON / syslog / webhook / S3"]
```

## 6. Deployment

```mermaid
flowchart TB
    lb["Load balancer / Ingress<br/>TLS 1.3"] --> gwp["api-gateway x N"]
    gwp --> svc["Stateless services x N<br/>core, runtime, integration,<br/>connector-hub, audit, analytics"]
    svc --> pgp[("PostgreSQL 16<br/>primary + sync replica<br/>PITR")]
    svc --> rds[("Redis<br/>Sentinel / Cluster")]
    svc --> natsc{{"NATS JetStream<br/>3-node cluster"}}
    svc --> obj[("S3 / MinIO<br/>versioned, WORM for audit")]
    otel["OTel Collector"] --> prom["Prometheus"] --> graf["Grafana"]
    svc -.-> otel
```

- **Cloud:** Kubernetes multi-AZ, HPA, PodDisruptionBudgets, managed Postgres/Redis optional.
- **On-prem:** Helm chart and docker-compose bundle; no external SaaS dependency; air-gap capable (offline image bundle).
- **HA targets:** 99.95% monthly, RPO ≤ 1 min, RTO ≤ 15 min; zero-downtime migrations (expand/contract).
- **Tenancy:** shared schema + RLS by default; dedicated-DB tier for regulated tenants. Per-tenant data keys (envelope encryption, KMS/Vault).
- **Residency:** region-pinned tenant placement for KVKK/GDPR.

## 7. Cross-cutting

| Concern | Approach |
|---|---|
| AuthN | OIDC/SAML at BFF; service-to-service mTLS + signed internal JWT (short TTL, audience-bound) |
| AuthZ | CASL abilities from RBAC roles + ABAC attributes (campaign, team, queue, data classification) |
| Observability | OTel traces across HTTP/NATS (W3C trace context), Prometheus RED metrics, pino JSON logs with redaction |
| Resilience | Timeouts everywhere, retries only for idempotent ops, circuit breakers, bulkheads, DLQ |
| Config | 12-factor env + typed config schema (zod); secrets from Vault/KMS/K8s secrets |
| Compliance | PII tagging, retention policies, DSAR export/erase tooling, PCI scope reduction (no PAN storage; masked/tokenized fields, pause-and-resume for payment capture) |
| API versioning | `/v1` URL; script `schemaVersion` with migrators ([SCRIPT_MODEL](SCRIPT_MODEL.md)) |

See also: [ADR index](adr/) and [COMPETITIVE](COMPETITIVE.md) for differentiators mapped to these components.

## Team authoring lifecycle

Designer uses the core API for review, immutable release-head rollback, assignments, signed
package dependencies and comments. Hocuspocus shares Yjs documents through the same-origin
WebSocket proxy; Redis leases fence HTTP autosave and lifecycle transitions. Snapshots and audit
commit in the tenant transaction. BullMQ delayed publication refreshes requester permissions and
regression gates. See [ADR-0028](adr/0028-lifecycle-collaboration-and-package-v2.md) and
[setup guide](DESIGNER_LIFECYCLE.md).
