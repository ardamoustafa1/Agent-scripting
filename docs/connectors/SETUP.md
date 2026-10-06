# Marketplace connector kurulumu

Sekiz adapter aynı SDK event/command sözleşmesini kullanır. Bunlar vendor SDKlarını taklit etmez: vendor credentials ve SDK facadeleri tenantın server bridge workerında çalışır. Webex/Finesse/Five9 desktop operasyonları için vendor host bundle ile authenticated server facade arasındaki bağlantı ayrıca sağlanmalıdır. Hub NATS transportu ve `MarketplaceSdkWorker` üretim taşımasını sağlar; licensed SDK paketleri ve tenant-specific auth bu depoya dahil edilmez.

1. Workspace bağımlılıklarını kur. SDK dist exportları için `pnpm --filter @verbis/sdk-connector... build` komutunu çalıştır; bu bir test komutu değildir. Test runner build yapmaz.
2. `infra/marketplace/connectors.example.json` dosyasından platform configini al. Mevcut connector admin/API akışından oluştur; credential içeriklerini yalnız Secret storea koy. `secrets.natsCreds` Secret UUID referansıdır. Örnekteki UUIDyi gerçek tenant Secret referansıyla değiştir.
3. NATS JetStream `VERBIS_MARKETPLACE` streamini `verbis.connector.<platform>.<connectorId>.event.v1` subjectleriyle oluştur. Hub ve bridge için farklı TLS credentials kullan; connector başına event/command/verify ve request-reply inbox ACLlerini daralt. Browsera NATS credentials verilmez.
4. Vendor-specific server SDK facadeı kur. `MarketplaceSdkWorker(platform, connectorId, port)` oluştur, `start(natsConfig, creds)` çağır. Native event inputları vendorın resmi SDK/API şemasından validate edilip aşağıdaki envelopea çevrilir; schema v1 vendor payloadının kendisi değildir. Amazon EventBridge için `amazonContactEvent` hazırdır. Diğer vendor event adları/fieldları kurulu SDK sürümüne göre facade katmanında eşlenmelidir.
5. `worker.publish(envelope)` yalnız durable JetStream ACK sonrasında döner. Kaynak mesajı/checkpointi bundan sonra ACK et. eventId vendorın sabit event idsi veya serverda kalıcı per-contact sequence olsun; retry yeni id üretmez. Polling uzun süre sessizse platformdaki assignment doğrulamasından alınan güncel snapshotı yeni eventId ile publish et; eski event zamanını yapay olarak yenileme. Katılımcı TTL varsayılan 60 s, azami 300 s.
6. Server portun `verifyParticipant` metodu güncel vendor call/task/agent sessionını sorgular; browser hints veya yalnız CRM record bilgisi döndüremez. Hub cached assignment + freshness + connected link + fresh server verificationın hepsini ister. Hata/unknown/transfer without target/end ⇒ false. Launch auditleri mevcut Prompt 11 akışındadır; event/command mutationları mevcut hub/API audit pipelineından geçer.
7. Attribute allow-list default boş (hiçbir alan okunmaz/yazılmaz). PII/PAN/secrets taşınmaz. Routing türleri queue, skill, campaign, taskQueue; routing aliases yalnız externalIdyi değiştirir. Verbis Campaign UUID seçilmez: campaign_external_mappings ve Assignment engine çözüm yapar.
8. Agent browser iframe sabit `/launch` açar; parent authenticated bildirimden gelen single-use codeu `#code` olarak iletebilir. Codes/PII localStorage veya loglara konmaz. CRM originleri `frame-ancestors` tenant allow-listesinde olmalı; CSRF, cookie/session binding, platform verifier ve assignment kontrolleri serverda yapılır. Browserın `@verbis/sdk-connector` ana entrypointini import etme (node:crypto içerir); yalnız `@verbis/sdk-connector/launch` browser-safe exportunu kullan.

```ts
// Server bridge bootstrap, vendor SDK/auth facade supplied by the tenant integration.
const port = createNiceCxonePort(agentApiFacade);
const worker = new MarketplaceSdkWorker('nice-cxone', connectorId, port);
await worker.start(natsConfig, await secretStore.get('bridgeNatsCreds'));
const poller = new AgentEventPoller(sessionPollApi, async (nativeEvent) => {
  const envelope = normalizeAndValidateInstalledNiceEvent(nativeEvent);
  await worker.publish(envelope);
});
// Host loop: await poller.pollOnce(abortController.signal); retry failures with backoff.
```

`agentApiFacade`, `sessionPollApi`, `secretStore` ve vendor normalizer yukarıda entegrasyon portlarını gösteren isimlerdir; hazır global fonksiyonlar değildir. Her platform rehberi gereken native operasyonları belirtir.

```json
{
  "version": 1,
  "platform": "nice-cxone",
  "event": {
    "eventId": "nice-session-1-contact-1-42",
    "type": "connected",
    "occurredAt": "2026-10-01T10:00:00.000Z",
    "platformInteractionId": "contact-1",
    "channel": "voice",
    "direction": "inbound",
    "agent": { "id": "agent-1" }
  },
  "routingId": "42",
  "variables": { "customerTier": "gold" }
}
```

Commands: `{platform, type, commandId, interactionId, attributes?|wrapUp?}`. Worker vendor success sonrası `{ok:true}`, hatada redacted `{ok:false,code,retryable}` döner. `writeAttributes` allow-listlidir; `setWrapUp` SDK WrapUpSchema ile validate edilir. Bounded memory dedupe process restartı kapsamaz: at-least-once retry için vendor operation idempotency veya tenant durable command journal gerekir. Flex completion ve diğer non-idempotent operasyonlarda bu journal production ön koşuludur. Aynı commandId + değiştirilmiş payload reddedilir. Hub errorları mevcut RFC 7807 filterından geçer; yeni public HTTP endpoint eklenmedi.

```sh
# Yazılmıştır; bu oturumda çalıştırılmadı.
pnpm test:marketplace
pnpm test:marketplace --typecheck
```

Production öncesi: vendor auth/facade ve native event normalizerlarını bağla, gerçek sandbox fixturelarıyla kanal/disposition/recording izinlerini doğrula, runnerı çalıştır, CRM/widget browser/axe doğrulamasını yap, durable command journalı ekle. Roadmap step 22 bu nedenle in progress olarak kalır.
