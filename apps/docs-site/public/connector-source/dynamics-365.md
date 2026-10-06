# Microsoft Dynamics 365 CIF

SDK connector: `generic` / kind `dynamics-cif`. Kanallar: voice (launch context). CIF CRM context read-only; call ownership upstream CTI tarafından doğrulanır.

Bu sürüm fixture tabanlı geliştirilmiştir; testler kullanıcı isteğiyle çalıştırılmadı. Vendor SDK facade bağları, lisans ve tenant sandbox doğrulaması tamamlanmadan production-ready olarak değerlendirilmemelidir.

## Kurulum

Önce [ortak kurulum ve bridge sözleşmesini](SETUP.md) uygula. Platform server portu: `createDynamicsCifPort` (`@verbis/sdk-connector`).

1. Dynamics CIF channel provider oluştur; tenant gereksinimine göre CIF v1/v2 seç, gerekli model-driven app ve rollere ata. Provider URL sabit HTTPS widget URLsi; trusted domain Verbis tenant originidir.
2. Provider sayfasında Microsoft CIF libraryyi resmi deployment yöntemiyle yükle. `infra/marketplace/dynamics-365/provider.mjs` dosyasını browser-safe `@verbis/sdk-connector/launch` entrypointiyle bundle et; Microsoft.CIFramework nesnesini cif olarak geçir.
3. mountDynamicsProvider({cif, container, agentOrigin, frameTitle, launchCode}) çağrısında frameTitle hostun tr/en i18n kataloğundan gelir; launchCode authenticated Verbis bildiriminin opaque handleıdır. getEnvironment yalnız host hazırlığını kontrol eder; user/recordId launch kanıtı değildir.
4. Server CrmLaunchApi.readRecordContext integration proxy ile izinli alanları okur. verifyCtiParticipant upstream CTI platformındaki aktif call/agent eşleşmesini yeniden doğrular; Dynamics record sahibi veya CIF environment bilgisi yeterli değildir.
5. CIF updateRecord API mevcut olsa da bu connector CRM mutation capability ilan etmez; yazma ayrıca server authz/audit ve alan allow-list gerektirir. CIF v2 session lifecycle host uygulamaya aittir; dispose iframeyi kaldırır.

## Connector config

```json
{
  "kind": "dynamics-cif",
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

`apps/connector-hub/src/connectors/dynamics-365/fixtures/voice-lifecycle.json` ve `invalid.json`; SDK contract kit lifecycle, dedupe, backpressure, command capability ve participant kontrollerini kapsar.

```sh
pnpm test:marketplace
pnpm test:marketplace --typecheck
```

Bu komutlar yazıldı; çalıştırılmadı. Capability ayrıntıları: [MATRIX](MATRIX.md).

## Kaynaklar

- [Resmi SDK/API dokümanı](https://learn.microsoft.com/en-gb/dynamics365/channel-integration-framework/channel-integration-framework)
- [Resmi kurulum / event referansı](https://learn.microsoft.com/en-us/dynamics365/channel-integration-framework/v1/develop/reference/microsoft-ciframework/updaterecord)
