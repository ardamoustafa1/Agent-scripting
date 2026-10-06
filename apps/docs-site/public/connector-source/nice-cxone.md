# NICE CXone

SDK connector: `nice-cxone` / kind `agent-api`. Kanallar: voice, chat, email, sms. Agent API ile contact custom data; skill → kampanya eşleme.

Bu sürüm fixture tabanlı geliştirilmiştir; testler kullanıcı isteğiyle çalıştırılmadı. Vendor SDK facade bağları, lisans ve tenant sandbox doğrulaması tamamlanmadan production-ready olarak değerlendirilmemelidir.

## Kurulum

Önce [ortak kurulum ve bridge sözleşmesini](SETUP.md) uygula. Platform server portu: `createNiceCxonePort` (`@verbis/sdk-connector`).

1. Cluster/base URI ve Agent API sürümünü tenant kurulumuna göre sabitle; OAuth tokenını Secret store üzerinden server bridge içinde al. Agent sessionını station id ile başlat veya desteklenen delegated sessiona bağlan.
2. AgentEventPoller.api.next metodunu session get-next-event long-poll çağrısına bağla; api.commit cursor/checkpointini kalıcı kayda yazar. Bir session için tek poller kullan. Cancellation için AbortSignal, hata döngüsü için jitter/backoff uygula.
3. Contact/agent session eventlerini envelope v1 biçimine dönüştür. Publish callbackini worker.publish ile bağla. Publish hatasında poller pending batchi tutar, cursorı ilerletmez; restart için server checkpoint store ve stable eventId gerekir.
4. routingId skillId olsun; event campaignRef.kind=skill olarak çıkar. Admin/API tarafında nice_cxone + skill + externalId için Campaign external mapping ekle. Örneğin skillId 42 → renewal dış anahtarı için routing {"42":"renewal"}; campaign eşlemesi renewal için tanımlanır. routing boşsa 42 doğrudan kullanılır.
5. DesktopSdkApi.readVariables/updateVariables/disposition metodlarını kurulu Agent API contact/custom-data/disposition operasyonlarına bağla. verifyParticipant mevcut agent sessionındaki aktif contact assignmentını yeniden sorgular. Digital kanal desteği lisansa bağlıdır; recordingControl bu sürümde ilan edilmez.

## Connector config

```json
{
  "kind": "agent-api",
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

`apps/connector-hub/src/connectors/nice-cxone/fixtures/voice-lifecycle.json` ve `invalid.json`; SDK contract kit lifecycle, dedupe, backpressure, command capability ve participant kontrollerini kapsar.

```sh
pnpm test:marketplace
pnpm test:marketplace --typecheck
```

Bu komutlar yazıldı; çalıştırılmadı. Capability ayrıntıları: [MATRIX](MATRIX.md).

## Kaynaklar

- [Resmi SDK/API dokümanı](https://developer.niceincontact.com/api/agentapi)
- [Resmi kurulum / event referansı](https://developer.niceincontact.com/Documentation/UsingEvents)
