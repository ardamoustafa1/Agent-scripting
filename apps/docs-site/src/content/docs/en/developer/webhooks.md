---
title: "Webhook contract"
---

The generic webhook connector verifies HMAC-SHA256 over the raw body. Header:

```text
X-Verbis-Signature: t=<unix-seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw-body>")>
```

Use server SDK signWebhook/verifyWebhook and resolve secrets server-side. Default timestamp tolerance
is 300 seconds, with eventId dedupe for replay protection. Rotation can carry multiple v1 signatures
in the same header. Sign raw JSON bytes, never parsed/reserialized bodies. Require TLS, body limits,
schema validation, retry/dedupe and tenant/connector-scoped routing. Read actual routes from connector
config/OpenAPI rather than inventing a public ingress. Trace correlation IDs without tokens/full payload logs.
