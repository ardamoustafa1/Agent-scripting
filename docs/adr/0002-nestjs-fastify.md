# ADR-0002: NestJS with Fastify adapter for backend services

- **Status:** Accepted · 2026-10-01
- **Related:** [ARCHITECTURE](../ARCHITECTURE.md), [ADR-0001](0001-monorepo.md)

## Context
Multiple backend services need consistent structure (DI, modules, guards, interceptors), OpenAPI generation, testability, and high throughput for runtime/launch paths.

## Decision
Use **NestJS** with the **Fastify** adapter. Domain logic is framework-free and injected; controllers stay thin. zod (via `nestjs-zod`-style pipes) validates input and drives OpenAPI. Global filter maps all errors to RFC 7807. Guards implement authN/CASL authZ. Interceptors handle tenant context (RLS transaction scope), audit emission, tracing.

## Consequences
- (+) Strong conventions, DI, mature ecosystem (BullMQ, OpenTelemetry, testing utils).
- (+) Fastify performance and schema-first mindset.
- (−) Decorator/metadata coupling; mitigate by isolating domain code from Nest.
- (−) Some Express-only middleware needs Fastify equivalents.

## Alternatives
- Fastify bare: fewer conventions across many services.
- Express/Koa: slower, less structure.
- Go/Java: stack uniformity with TypeScript front end and shared schemas preferred.
