# Agent workspace

SSO-authenticated agent desktop using the existing secure launch service and `@verbis/core-runtime`.
See [deployment and acceptance guide](../../docs/AGENT_DESKTOP.md).

```sh
pnpm --filter @verbis/agent-web dev
pnpm --filter @verbis/agent-web build
```

Tests were written, not executed. Future explicit execution:

```sh
pnpm test:agent
pnpm test:agent --e2e
```
