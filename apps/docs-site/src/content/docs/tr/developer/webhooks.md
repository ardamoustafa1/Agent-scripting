---
title: "Webhook sözleşmesi"
---

Generic webhook connector raw body üzerinde HMAC-SHA256 doğrular. Header:

```text
X-Verbis-Signature: t=<unix-seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw-body>")>
```

Server SDK’daki signWebhook/verifyWebhook kullanın; secret yalnız server’da çözülür. Varsayılan zaman
toleransı 300 saniyedir; eventId dedupe ile replay korunur. Secret rotation için aynı header’da birden
fazla v1 imzası taşınabilir. Raw JSON bytes imzalanır, parse/yeniden serialize edilen gövde değil.
TLS, body limit, schema validation, retry/dedupe ve tenant/connector scoped route gereklidir. Endpoint
route’unu ilgili connector config/OpenAPI’den alın; tahmini bir public ingress eklemeyin.
Tüm çağrılarda correlation ID takip edin, token/full payload loglamayın.
