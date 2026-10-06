---
title: "Cisco UCCE/PCCE Finesse"
---

Adapter kind: `finesse-gadget`.

Finesse gadget layout ve trusted HTTPS originleri kurun. Server facade dialog/user lookup ve callVariable1..10/user.* ECC allow-list uygulasın. Native wrap-up reason’ı tenant kodlarına eşleyin.

## Kurulum adımları

1. Vendor lisansı, API/SDK sürümü, kanal izinleri ve test tenant’ını hazırlayın; destek matrisi yalnız kodun ilan ettiği capability’dir.
2. Verbis admin’de adapter/kind config’i oluşturun. Vendor auth ve NATS credentials yalnız Secret store referansı olsun.
3. Yukarıdaki vendor kurulumunu ve [ortak bridge kurulumunu](/tr/connectors/setup/) tamamlayın. Hub/bridge için farklı tenant-scoped TLS/NATS yetkisi verin.
4. External queue/skill/campaign ID’lerini Verbis kampanyasına map edin; connector event’i campaign UUID seçmez. Agent platform ID’lerini doğrulanmış Verbis kullanıcılarıyla eşleyin.
5. Transfer, end, stale participant, duplicate event/command ve wrap-up senaryolarını izole sandbox’ta kabul edin; başarısız verifier launch’ı kapatır.

## Config örneği

```json
{
  "kind": "finesse-gadget",
  "nats": {
    "servers": [
      "tls://nats.example.test:4222"
    ],
    "stream": "VERBIS_MARKETPLACE",
    "requestTimeoutMs": 5000
  },
  "attributeAllowList": [
    "callVariable1",
    "user.segment"
  ],
  "routing": {},
  "participantTtlSeconds": 60,
  "secrets": {
    "natsCreds": "00000000-0000-4000-8000-000000000001"
  }
}
```

Örnek Secret UUID/domain değerlerini gerçek tenant referanslarıyla değiştirin. [Kaynak kurulum notları](/connector-source/cisco-finesse.md). Lisanslı SDK/auth facade ve gerçek vendor sandbox kabulü production ön koşuludur; testler bu oturumda çalıştırılmadı.
