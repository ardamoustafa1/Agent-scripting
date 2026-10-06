# syntax=docker/dockerfile:1.7
# Builds a NestJS app from the monorepo. Usage:
#   docker build -f infra/docker/node-app.Dockerfile --build-arg APP=api -t verbis/api .
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-trixie-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo

FROM base AS pruner
ARG APP
COPY . .
RUN pnpm dlx turbo@2.11.6 prune "@verbis/${APP}" --docker

FROM base AS builder
ARG APP
COPY --from=pruner /repo/out/json/ .
COPY .npmrc ./
COPY scripts ./scripts
COPY patches ./patches
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
RUN pnpm turbo run build --filter="@verbis/${APP}" \
 && pnpm --filter="@verbis/${APP}" deploy --prod /out

FROM node:${NODE_VERSION}-trixie-slim AS migration
ENV NODE_ENV=production HOME=/tmp XDG_CACHE_HOME=/tmp/.cache
WORKDIR /repo/apps/api
COPY --from=builder --chown=65532:65532 /repo /repo
USER 65532:65532
CMD ["node", "--import", "tsx", "scripts/migrate.mjs"]

FROM gcr.io/distroless/nodejs22-debian13:nonroot AS runtime
ARG APP
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder --chown=65532:65532 /out ./
USER 65532:65532
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:4000/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["dist/main.js"]
