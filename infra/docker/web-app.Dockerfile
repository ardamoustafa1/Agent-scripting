# syntax=docker/dockerfile:1.7
# Builds a Vite web app and serves it with unprivileged nginx. Usage:
#   docker build -f infra/docker/web-app.Dockerfile --build-arg APP=agent-web -t verbis/agent-web .
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-alpine AS base
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
COPY tests ./tests
RUN pnpm turbo run build --filter="@verbis/${APP}" && cp -r "apps/${APP}/dist" /out

FROM nginxinc/nginx-unprivileged:1.31-alpine AS runtime
USER root
RUN apk upgrade --no-cache
ARG APP
COPY infra/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY infra/docker/frame-sources.conf /etc/nginx/snippets/frame-sources.conf
COPY infra/docker/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=builder /out /usr/share/nginx/html
USER 101
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD-SHELL wget -q -O- http://127.0.0.1:8080/health >/dev/null || exit 1
EXPOSE 8080
