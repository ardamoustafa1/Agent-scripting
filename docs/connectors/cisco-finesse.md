# Cisco UCCE/PCCE — Finesse

SDK connector: `cisco` / kind `finesse-gadget`. Kanallar: voice. callVariable1..10 ve user.* ECC; native uzunluk limitlerini tenant configinde daralt.

Bu sürüm fixture tabanlı geliştirilmiştir; testler kullanıcı isteğiyle çalıştırılmadı. Vendor SDK facade bağları, lisans ve tenant sandbox doğrulaması tamamlanmadan production-ready olarak değerlendirilmemelidir.

## Kurulum

Önce [ortak kurulum ve bridge sözleşmesini](SETUP.md) uygula. Platform server portu: `createFinessePort` (`@verbis/sdk-connector`).

1. Gadgetı UCCE/PCCE Finesse desktop layoutuna ekle; HTTPS origin/CSP ve gadget izinlerini ayarla. Finesse sessionı mevcut hosttan kullan; service credentials gadgeta taşınmaz.
2. Dialog collection add/change/delete notificationlarından alerting, connected, held, transfer, wrap-up ve ended durumlarını normalize et. Dialog id platformInteractionId; User id agent id olur. Stable eventId için platform sequence veya bridge persistent sequence kullan.
3. DesktopSdkApi.readVariables: Dialog mediaProperties.callvariables + ECC snapshotı. updateVariables: Finesse Dialog UPDATE_CALL_DATA operasyonu. SDK portu callVariable1..10 ve user.* isimlerini doğrular; Finesse deploymentının gerçek alan limitlerini ayrıca uygula.
4. Disposition: Dialog wrap-up reason operasyonunu ilgili Finesse sürümüyle bağla; ACW bitişini agent NOT_READY değişimiyle karıştırma. verifyParticipant sunucuda güncel User Dialogs collection ve aktif Dialog participantsı kontrol eder.
5. Tenant routing queue/skill externalId alanlarını campaign_external_mappings içine ekle. Hub raw XML kabul etmez; SOAP/XML kullanılan server facade XXE kapalı parser kullanmalıdır.

## Connector config

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

## Güvenli launch (Prompt 11)

Sabit `/launch` ve yalnız Verbis tarafından verilmiş opaque `#code` kullanılır. Script/campaign/user/interaction query parametreleriyle ekran açılmaz. BFF cookie + CSRF, tek kullanımlık/TTL/binding kontrolü, server assignment ve güncel platform katılımcı kontrolü mevcut redemption akışında uygulanır. CRM record ownerı launch yetkisi vermez. Frame hostları tenant allow-listesiyle sınırlandırılır; izin gerektiren login popup desteklenebilir.

## Fixture ve komutlar

`apps/connector-hub/src/connectors/cisco-finesse/fixtures/voice-lifecycle.json` ve `invalid.json`; SDK contract kit lifecycle, dedupe, backpressure, command capability ve participant kontrollerini kapsar.

```sh
pnpm test:marketplace
pnpm test:marketplace --typecheck
```

Bu komutlar yazıldı; çalıştırılmadı. Capability ayrıntıları: [MATRIX](MATRIX.md).

## Kaynaklar

- [Resmi SDK/API dokümanı](https://developer.cisco.com/docs/finesse/mediapropertieslayout/)
- [Resmi kurulum / event referansı](https://www.cisco.com/c/en/us/support/docs/contact-center/unified-contact-center-enterprise-1262/222937-track-task-routing-events-in-a-cce.pdf)
