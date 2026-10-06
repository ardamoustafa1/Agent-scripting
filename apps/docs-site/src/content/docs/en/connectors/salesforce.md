---
title: "Salesforce Open CTI"
---

Adapter kind: `salesforce-open-cti`.

Configure Open CTI call-center adapter/softphone layout and approved iframe origins. Connect the upstream telephony provider to an authenticated server verifier. CRM record ownership is not proof; this connector supplies CRM launch-only context.

## Installation steps

1. Prepare vendor licensing, installed API/SDK version, channel permissions and a sandbox tenant; the matrix lists declared code capabilities only.
2. Create adapter/kind config in Verbis administration. Vendor auth and NATS credentials are Secret store references only.
3. Complete the vendor-specific setup above and [common bridge setup](/en/connectors/setup/). Give hub/bridge separate tenant-scoped TLS/NATS permissions.
4. Map external queue/skill/campaign IDs to a Verbis campaign; events never select a campaign UUID. Bind platform agent IDs to verified Verbis users.
5. Accept transfer, end, stale participation, duplicate events/commands and wrap-up in isolation. Failed verification closes launch.

## Config example

```json
{
  "kind": "salesforce-open-cti",
  "nats": {
    "servers": [
      "tls://nats.example.test:4222"
    ],
    "stream": "VERBIS_MARKETPLACE",
    "requestTimeoutMs": 5000
  },
  "attributeAllowList": [
    "verbisOutcome",
    "customerTier"
  ],
  "routing": {},
  "participantTtlSeconds": 60,
  "secrets": {
    "natsCreds": "00000000-0000-4000-8000-000000000001"
  }
}
```

Replace example Secret UUIDs/domains with tenant-scoped references. [Source installation notes](/connector-source/salesforce.md). Licensed SDK/auth facades and real vendor sandbox acceptance are production prerequisites; tests were not executed in this session.
