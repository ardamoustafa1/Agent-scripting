# Amazon Connect

SDK connector: `amazon-connect` / kind `contact-events`. Kanallar: voice, chat, email, callback. GetContactAttributes / UpdateContactAttributes; InitialContactId üzerinden okuma/yazma.

Bu sürüm fixture tabanlı geliştirilmiştir; testler kullanıcı isteğiyle çalıştırılmadı. Vendor SDK facade bağları, lisans ve tenant sandbox doğrulaması tamamlanmadan production-ready olarak değerlendirilmemelidir.

## Kurulum

Önce [ortak kurulum ve bridge sözleşmesini](SETUP.md) uygula. Platform server portu: `createAmazonConnectPort` (`@verbis/sdk-connector`).

1. EventBridge kuralını `source=aws.connect`, `detail-type=Amazon Connect Contact Event` ve doğru instance/account ile sınırla; hedef Lambda veya Kinesis consumer olsun. Kinesis kaydının JSON gövdesini decode et; CTR/agent event stream formatını contact event sanma.
2. `amazonContactEvent(payload, instanceArn, await port.readAttributes(contactId))` ile normalize et; dönen envelope varsa `worker.publish(envelope)` çağır. AWS consumer checkpoint/ACK işlemini publish tamamlandıktan sonra yap. Contact attribute anahtarlarını allow-list ile filtrele.
3. `@aws-sdk/client-connect` SDK sürümünü tenant entegrasyon paketinde sabitle. Promise facade metodlarını `client.send(new GetContactAttributesCommand(input))`, `UpdateContactAttributesCommand`, `DescribeContactCommand`, `SuspendContactRecordingCommand`, `ResumeContactRecordingCommand` çağrılarına bağla. Instance ARN/ID server config olsun; IAM instance-scoped izinler kullan.
4. CCP alternatifi için `infra/marketplace/amazon-connect/ccp.mjs` dosyasını `amazon-connect-streams` ile bundle et; HTTPS uygulama originini Connect Application Integration allow-listesine ekle. `acceptHint` tarayıcı bilgisini güvenilir event olarak yayınlamamalı: mevcut BFF oturumunu doğrula ve AWS DescribeContact ile server tarafında zenginleştir. Bu BFF ingress tenant entegrasyonuna aittir.
5. Wrap-up native outcome store olarak ilan edilmez. DISCONNECTED → wrapupRequired; COMPLETED → ended. Kayıt kontrolü yalnız voice recording etkin ve IAM izinleri varsa çalışır. TASK kanalı mevcut SDK kanal enumunda olmadığı için mapper tarafından atlanır.

## Connector config

```json
{
  "kind": "contact-events",
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

`apps/connector-hub/src/connectors/amazon-connect/fixtures/voice-lifecycle.json` ve `invalid.json`; SDK contract kit lifecycle, dedupe, backpressure, command capability ve participant kontrollerini kapsar.

```sh
pnpm test:marketplace
pnpm test:marketplace --typecheck
```

Bu komutlar yazıldı; çalıştırılmadı. Capability ayrıntıları: [MATRIX](MATRIX.md).

## Kaynaklar

- [Resmi SDK/API dokümanı](https://github.com/amazon-connect/amazon-connect-streams)
- [Resmi kurulum / event referansı](https://docs.aws.amazon.com/connect/latest/adminguide/contact-events.html)
