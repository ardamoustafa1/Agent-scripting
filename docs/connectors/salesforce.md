# Salesforce Open CTI / Lightning

SDK connector: `generic` / kind `salesforce-open-cti`. Kanallar: voice (launch context). CRM record context read-only; telephony commands CTI connectora gider.

Bu sürüm fixture tabanlı geliştirilmiştir; testler kullanıcı isteğiyle çalıştırılmadı. Vendor SDK facade bağları, lisans ve tenant sandbox doğrulaması tamamlanmadan production-ready olarak değerlendirilmemelidir.

## Kurulum

Önce [ortak kurulum ve bridge sözleşmesini](SETUP.md) uygula. Platform server portu: `createSalesforceOpenCtiPort` (`@verbis/sdk-connector`).

1. `infra/marketplace/salesforce/lwc/verbisLaunch` ile labels ve tr translations dosyalarını Salesforce metadata projesine kopyala; sf CLI ile hedef orga deploy et. Lightning App Builder içinde Record/App/Home page veya Utility Bar bileşenini yerleştir.
2. agentOrigin HTTPS Verbis tenant originidir; CSP Trusted URLs ve Verbis frame-ancestors politikasında yalnız ilgili Salesforce org originini allow-list et. Open CTI softphone Salesforce tarafından sağlanan lightning/opencti library ile ayrı host olarak başlatılır.
3. LWC parent host authenticated launch notificationdan aldığı opaque codeu launchCode propertysine verir. İstemciden recordId/campaignId/userId → script seçimi yoktur. Statik bileşen /launch açar ve kod gelmeden session başlatmaz.
4. Open CTI telephony provider eventlerini server bridge ile normalleştir. readRecordContext server integration proxy üzerinden izinli CRM alanlarını okur. verifyCtiParticipant upstream CTI connector/platformın aktif katılımcı kontrolüne delege eder; Salesforce record ownerı call participant sayılmaz.
5. CRM connectorını ayrıca kullanıyorsan upstream CTI connectorla duplicate launch oluşmaması için tek event owner belirle. CRM UI tek başına kullanılacaksa upstream CTI connector id ile issued launch code al. Write-back/wrap-up/recording CRM capabilities olarak ilan edilmez.

## Connector config

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

## Güvenli launch (Prompt 11)

Sabit `/launch` ve yalnız Verbis tarafından verilmiş opaque `#code` kullanılır. Script/campaign/user/interaction query parametreleriyle ekran açılmaz. BFF cookie + CSRF, tek kullanımlık/TTL/binding kontrolü, server assignment ve güncel platform katılımcı kontrolü mevcut redemption akışında uygulanır. CRM record ownerı launch yetkisi vermez. Frame hostları tenant allow-listesiyle sınırlandırılır; izin gerektiren login popup desteklenebilir.

## Fixture ve komutlar

`apps/connector-hub/src/connectors/salesforce/fixtures/voice-lifecycle.json` ve `invalid.json`; SDK contract kit lifecycle, dedupe, backpressure, command capability ve participant kontrollerini kapsar.

```sh
pnpm test:marketplace
pnpm test:marketplace --typecheck
```

Bu komutlar yazıldı; çalıştırılmadı. Capability ayrıntıları: [MATRIX](MATRIX.md).

## Kaynaklar

- [Resmi SDK/API dokümanı](https://developer.salesforce.com/docs/service/api-cti/guide/sforce-api-cti-connecting.html)
- [Resmi kurulum / event referansı](https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/api_cti.pdf)
