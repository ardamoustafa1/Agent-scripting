# Five9

SDK connector: `five9` / kind `desktop-toolkit`. Kanallar: voice, chat, email. Agent Desktop Toolkit call variables; wrap-up disposition.

Bu sürüm fixture tabanlı geliştirilmiştir; testler kullanıcı isteğiyle çalıştırılmadı. Vendor SDK facade bağları, lisans ve tenant sandbox doğrulaması tamamlanmadan production-ready olarak değerlendirilmemelidir.

## Kurulum

Önce [ortak kurulum ve bridge sözleşmesini](SETUP.md) uygula. Platform server portu: `createFive9ToolkitPort` (`@verbis/sdk-connector`).

1. Five9 tenantınızdan Agent Desktop Toolkit ve ilgili sürümün dokümanlarını temin et. Lisanslı SDK bu depoya eklenmez; host bundle içindeki sürümü sabitle.
2. Toolkit event notificationlarını initialize/call offer/connected/hold/transfer/disposition/end durumlarına eşle; call id ve agent id server bridge tarafından doğrulanır. Vendor event isimleri sürüme göre değiştiği için tahmini global API isimleri kullanılmaz.
3. DesktopSdkApi.readVariables/updateVariables metodlarını Toolkit call variable okuma/güncelleme operasyonuna; disposition metodunu native dispositiona bağla. campaign id routingId olur; allow-list ile sadece scriptte kullanılan variablelar taşınır.
4. Server verifyParticipant agentın mevcut aktif call/contact listesini sorgular. Browser agentId claimi veya CRM record erişimi yeterli değildir. Browser → bridge kanalını authenticated BFF üzerinden kur.
5. Voice/chat/email yetkilerini tenant lisansında doğrula. Recording controls native Five9 deploymentıyla doğrulanmadığı için capability olarak ilan edilmez.

## Connector config

```json
{
  "kind": "desktop-toolkit",
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

`apps/connector-hub/src/connectors/five9/fixtures/voice-lifecycle.json` ve `invalid.json`; SDK contract kit lifecycle, dedupe, backpressure, command capability ve participant kontrollerini kapsar.

```sh
pnpm test:marketplace
pnpm test:marketplace --typecheck
```

Bu komutlar yazıldı; çalıştırılmadı. Capability ayrıntıları: [MATRIX](MATRIX.md).

## Kaynaklar

- [Resmi SDK/API dokümanı](https://documentation.five9.com/)
- [Resmi kurulum / event referansı](https://github.com/Five9DeveloperProgram/Five9AgentScriptSample)
