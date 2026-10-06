# @verbis/sdk-connector

Contract for Verbis connectors ([ADR-0018](../../docs/adr/0018-connector-sdk-and-hub.md)).

1. Implement `Connector` (capabilities, `init/health/shutdown`, commands, `verifyParticipant`).
2. Write a mapper: `defineMapper({ name, payloadSchema, map })` turning a platform payload into
   normalized `InteractionEvent`s; call `mapPlatformEvent` from your transport.
3. Emit with `ctx.emit(event)`; on `BackpressureError` stop consuming / NACK / answer 503.
   Mark an event as seen only after `emit` resolved.
4. Record real platform payloads in `fixtures/*.json` and run the shared contract:

```ts
import { runConnectorContract } from '@verbis/sdk-connector/testing';

runConnectorContract({
  name,
  create,
  config,
  secrets,
  fixtures,
  invalidPayloads,
  participant,
  ingest,
});
```

Script authors read channel context through `channel.*` variables (`toScriptVariables`).
