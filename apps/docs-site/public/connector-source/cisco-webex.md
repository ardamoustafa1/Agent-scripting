# Cisco Webex Contact Center

SDK connector: `cisco` / kind `desktop-widget`. Kanallar: voice, chat, email. CAD değişkenleri; salt okunur CAD alanları yazılmamalı.

Bu sürüm fixture tabanlı geliştirilmiştir; testler kullanıcı isteğiyle çalıştırılmadı. Vendor SDK facade bağları, lisans ve tenant sandbox doğrulaması tamamlanmadan production-ready olarak değerlendirilmemelidir.

## Kurulum

Önce [ortak kurulum ve bridge sözleşmesini](SETUP.md) uygula. Platform server portu: `createWebexDesktopPort` (`@verbis/sdk-connector`).

1. Widget bundle içinde sabitlenmiş `@wxcc-desktop/sdk` import et; `Desktop.config.init()` ile başlat ve HTTPS widgetı Desktop Layout içine ekle.
2. `Desktop.actions.getTaskMap()` ile başlangıç snapshotını al; `Desktop.agentContact.addEventListener` ile teklif, bağlantı, hold/unhold, transfer ve wrap-up eventlerini izle; release sürümüne göre event isimlerini eşle. Browser callbackleri server-side platform lookup ile teyit edilmelidir.
3. DesktopSdkApi.readVariables metodunu task CAD snapshotına, updateVariables metodunu `Desktop.dialer.updateCadVariables` çağrısına ve disposition metodunu tenantın wrap-up SDK operasyonuna bağla. Payload şekli sürüme bağlıdır; native sample ile doğrula.
4. widget ↔ server bridge hattını authenticated BFF üzerinden kur; NATS veya vendor service tokenını widget içine koyma. Server verifyParticipant güncel platform task assignmentını kontrol etsin.
5. Routing queue/entry-point externalId eşlemelerini Assignment engine tarafında tanımla. Bu sürüm recording control ilan etmez; Webex recording API desteği ayrıca tenant sürümüyle doğrulanmalıdır.

## Connector config

```json
{
  "kind": "desktop-widget",
  "nats": {
    "servers": ["tls://nats.example.test:4222"],
    "stream": "VERBIS_MARKETPLACE",
    "requestTimeoutMs": 5000
  },
  "attributeAllowList": ["verbisOutcome", "customerTier"],
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

`apps/connector-hub/src/connectors/cisco-webex/fixtures/voice-lifecycle.json` ve `invalid.json`; SDK contract kit lifecycle, dedupe, backpressure, command capability ve participant kontrollerini kapsar.

```sh
pnpm test:marketplace
pnpm test:marketplace --typecheck
```

Bu komutlar yazıldı; çalıştırılmadı. Capability ayrıntıları: [MATRIX](MATRIX.md).

## Kaynaklar

- [Resmi SDK/API dokümanı](https://developer.webex.com/blog/leveraging-the-webex-contact-center-agent-desktop-sdk-in-your-custom-widgets)
- [Resmi kurulum / event referansı](https://developer.webex.com/webex-contact-center/docs/sdks/webex-contact-center-web-sdk-quickstart)
