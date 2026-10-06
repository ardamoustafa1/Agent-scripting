# Twilio Flex

SDK connector: `generic` / kind `flex-plugin`. Kanallar: voice, chat, sms, whatsapp. TaskRouter attributes merge; completion/disposition facade.

Bu sürüm fixture tabanlı geliştirilmiştir; testler kullanıcı isteğiyle çalıştırılmadı. Vendor SDK facade bağları, lisans ve tenant sandbox doğrulaması tamamlanmadan production-ready olarak değerlendirilmemelidir.

## Kurulum

Önce [ortak kurulum ve bridge sözleşmesini](SETUP.md) uygula. Platform server portu: `createTwilioFlexPort` (`@verbis/sdk-connector`).

1. Sabitlenmiş Flex Plugins CLI/UI SDK ile plugin oluştur; tenant Flex hesabında deploy et. Plugin server TaskRouter credentials içermez; worker client ve mevcut host sessionını kullanır.
2. Flex task/reservation eventlerinden Task SID, Worker SID ve channelı normalize et. TaskQueue SID routingId olur. accepted reservation connected; wrapping wrapupRequired; completed/canceled ended olarak eşlenir.
3. FlexSdkApi.task metodunu tenant-scoped TaskRouter task lookupına bağla; setAttributes full task attributesı mevcut nested alanlarla birlikte merge ederek günceller. SDK portu yeni Verbis alanlarını flat AttributesSchema ile doğrular.
4. FlexSdkApi.complete native Flex complete task/disposition akışını çalıştırır; disposition alanını task attributes içinde tenant standardına göre persist et. verifyParticipant server TaskRouter reservationın accepted/wrapping, workerın eşleştiği ve taskın terminal olmadığını doğrular.
5. Mevcut DB adapter enumunu değiştirmemek için generic + flex-plugin kullanılır. SCIM CTI identity generic namespace içinde bu connectora doğru eşlenmelidir; farklı generic connectorlar için aynı kimlik anahtarının çakışmasını tenantta engelle.

## Connector config

```json
{
  "kind": "flex-plugin",
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

## Güvenli launch (Prompt 11)

Sabit `/launch` ve yalnız Verbis tarafından verilmiş opaque `#code` kullanılır. Script/campaign/user/interaction query parametreleriyle ekran açılmaz. BFF cookie + CSRF, tek kullanımlık/TTL/binding kontrolü, server assignment ve güncel platform katılımcı kontrolü mevcut redemption akışında uygulanır. CRM record ownerı launch yetkisi vermez. Frame hostları tenant allow-listesiyle sınırlandırılır; izin gerektiren login popup desteklenebilir.

## Fixture ve komutlar

`apps/connector-hub/src/connectors/twilio-flex/fixtures/voice-lifecycle.json` ve `invalid.json`; SDK contract kit lifecycle, dedupe, backpressure, command capability ve participant kontrollerini kapsar.

```sh
pnpm test:marketplace
pnpm test:marketplace --typecheck
```

Bu komutlar yazıldı; çalıştırılmadı. Capability ayrıntıları: [MATRIX](MATRIX.md).

## Kaynaklar

- [Resmi SDK/API dokümanı](https://www.twilio.com/docs/flex/developer/ui/overview-of-flex-ui-programmability-options)
- [Resmi kurulum / event referansı](https://www.twilio.com/docs/flex/admin-guide/core-concepts/routing)
