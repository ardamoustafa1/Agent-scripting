# connector-genesys-engage-sidecar

Java 21 + Spring Boot sidecar for the Genesys Engage connector, mode **(b)** of
[docs/connectors/genesys-engage.md](../../docs/connectors/genesys-engage.md) and
[ADR-0019](../../docs/adr/0019-genesys-engage-connector.md).

What it does:

- Uses the Platform SDK to read T-Server events (registered agent DNs, `ModeShare`) and
  Interaction Server events (as `ReportingEngine`, with a `Proxy` connection for write-back).
- Publishes neutral envelopes (`contracts/engage-envelope.v1.json`) to NATS JetStream.
- Answers the hub's command and verify requests.

It never uses WDE and never changes agent state.

```bash
gradle test                                    # unit + Testcontainers (Docker required)
gradle bootJar -Ppsdk.repo=<url> -Ppsdk.version=<v>   # with the licensed Platform SDK
docker build --build-arg PSDK_REPO=<url> -t verbis/engage-sidecar .
```

Configuration is in `application.yml` (environment variables). Secrets are mounted files:

- `NATS_CREDS_FILE`: NATS user credentials scoped to `verbis.connector.engage.<connectorId>.>`;
- `CONFSERV_PASSWORD_FILE`: the Config Server password.
