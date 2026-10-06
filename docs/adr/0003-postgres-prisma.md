# ADR-0003: PostgreSQL 16 + Prisma with Row-Level Security multi-tenancy

- **Status:** Accepted · 2026-10-01
- **Related:** [DOMAIN](../DOMAIN.md), [SECURITY §3](../SECURITY.md)

## Context
Multi-tenant data with strong isolation, transactional integrity (domain change + outbox + audit), JSONB for script documents, and on-prem friendliness.

## Decision
- **PostgreSQL 16** as system of record; JSONB for `ScriptVersion.document` with generated columns/indexes for query fields.
- **Prisma** for schema, migrations, and typed access. Where Prisma lacks features (RLS policies, triggers, partitioning, append-only audit grants), use raw SQL migrations reviewed and tested.
- **Shared schema + `tenant_id` + RLS** by default: each request runs in a transaction that `SET LOCAL app.tenant_id`; policies enforce `tenant_id = current_setting('app.tenant_id')`. Application DB role is non-superuser and cannot bypass RLS. A dedicated-database tier is available for regulated tenants.
- **Transactional outbox** table for event publication.
- **Audit store** has no UPDATE/DELETE privileges and a blocking trigger.
- UUIDv7 primary keys; `timestamptz` UTC.
- Expand/contract migrations for zero downtime.

## Consequences
- (+) Defense-in-depth isolation independent of application bugs; ACID with outbox.
- (−) Prisma + RLS requires a tenant-scoped client wrapper and disciplined raw SQL; CI tests assert cross-tenant access fails.
- (−) JSONB documents need size limits and validation.

## Alternatives
- Schema-per-tenant: operational burden at scale, migration fan-out.
- Database-per-tenant only: cost/complexity; offered as tier instead.
- TypeORM/Drizzle: Prisma chosen for schema tooling and team familiarity.
