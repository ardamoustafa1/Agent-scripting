---
title: "Connector SDK"
---

Implement server-only `@verbis/sdk-connector` Connector lifecycle, events, verifyParticipant,
capabilities and supported commands. Browser code uses only `@verbis/sdk-connector/launch`.

Validate native payloads against the installed vendor version and normalize with the mapper. Keep
stable event IDs across retries and real platform occurredAt. Verify current participation using the
server SDK; browser hints/CRM record ownership are not proofs. ACK the source only after JetStream ACK.
Configure SecretRef resolution, reconnect/backoff, durable command idempotency and tenant-scoped ACLs.

Use the shared contract kit for connect/disconnect, normalization, write-back, transfer/end and stale
assignments. Never enable recording/wrap-up features you do not declare. TESTING.md lists commands;
this guide makes no passing-test claim.
