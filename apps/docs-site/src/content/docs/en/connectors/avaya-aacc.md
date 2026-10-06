---
title: "Avaya AACC"
---

Adapter kind: `sidecar`.

Configure the licensed AACC connection through the sidecar. Define agent/contact identity, voice/email/chat/sms/social permissions, intrinsic-field allow-list and disposition codes.

## Installation steps

1. Prepare vendor licensing, installed API/SDK version, channel permissions and a sandbox tenant; the matrix lists declared code capabilities only.
2. Create adapter/kind config in Verbis administration. Vendor auth and NATS credentials are Secret store references only.
3. Complete the vendor-specific setup above and [common bridge setup](/en/connectors/setup/). Give hub/bridge separate tenant-scoped TLS/NATS permissions.
4. Map external queue/skill/campaign IDs to a Verbis campaign; events never select a campaign UUID. Bind platform agent IDs to verified Verbis users.
5. Accept transfer, end, stale participation, duplicate events/commands and wrap-up in isolation. Failed verification closes launch.

Replace example Secret UUIDs/domains with tenant-scoped references. [Source installation notes](/connector-source/avaya.md). Licensed SDK/auth facades and real vendor sandbox acceptance are production prerequisites; tests were not executed in this session.
