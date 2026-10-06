# Connector capabilities

Bu tablo connector kodunun ilan ettiği desteği ve **nasıl doğrulandığını** gösterir. Kanal lisansı, deployment sürümü ve aşağıdaki koşullar ayrıca geçerlidir. Doğrulama düzeyleri:

- **Sahte:** depodaki sahte sunucu ya da fixture'lara karşı test edildi.
- **Sandbox:** sözleşme testi gerçek bir vendor sandbox'ında geçti.
- **Lab:** vendor lab'ında doğrulandı.

Henüz hiçbir connector Sandbox ya da Lab düzeyinde değil.

## Etkin connector'lar (bu depoda olanlar)

| Connector / kind | Kanal | Write-back | Wrap-up | Kayıt kontrolü | Doğrulama |
|---|---|---|---|---|---|
| Genesys Cloud / cloud | voice, chat, email, sms, whatsapp, social, callback | Participant attributes | Codes | Pause/resume | Sahte. Sandbox sözleşme testi yazıldı ama çalıştırılmadı ([§8.1](genesys-cloud.md)) |
| Genesys Engage / workspace | voice, chat, email, sms, whatsapp, social | Attached data | Disposition / outbound result | Hayır | Sahte |
| Genesys Engage / sidecar | voice, chat, email, sms, whatsapp, social | Attached data | Disposition / outbound result | Hayır | Sahte. PSDK kaynağı yalnızca lisanslı jar ile derlenir. `SIDECAR_SOURCE=psdk` zorunlu |
| Avaya AES / sidecar | voice | Hayır | Outbound result / recorder tag (config) | Recorder hook (config) | Sahte. JTAPI kaynağı yalnızca lisanslı jar ile derlenir. `SIDECAR_SOURCE=aes` zorunlu |
| Avaya AACC / sidecar | voice, email, chat, sms, social | Intrinsics | Disposition | Recorder hook (config) | Sahte. CCMM operasyonları varsayım ([avaya.md](avaya.md)) |
| Avaya AXP / workspaces | voice, chat, email, sms, whatsapp, social | Hayır | Wrap-up | Recorder hook (config) | Sahte. Token ve wrap-up uç noktaları varsayım (M-25) |
| Generic / webhook | voice, chat, email, sms, whatsapp, social, video, callback | İmzalı callback (config) | İmzalı callback (config) | Hayır | Gerçek HTTP |
| Generic / simulator | tümü | Simüle | Simüle | Simüle | Yalnızca dev/demo; üretimde reddedilir |

Sidecar'lar hiçbir zaman kaydedilmiş olaylara geri düşmez. Boş ya da bilinmeyen bir `SIDECAR_SOURCE` başlangıcı durdurur. `replay` yalnızca `SIDECAR_ALLOW_REPLAY=true` ile birlikte kabul edilir (dev/test). Health yanıtı etkin `source` değerini gösterir.

## Kullanılamaz: depoda olmayan bir vendor köprüsü gerektirir

Amazon Connect, Cisco Webex, Cisco UCCE/PCCE (Finesse), NICE CXone, Five9, Twilio Flex, Salesforce Open CTI ve Dynamics 365 CIF için **bu depoda vendor SDK entegrasyonu yok**. Hub sınıfları (`MarketplaceConnector`) yalnızca ayrı kurulan, imzalı bir vendor köprüsünün NATS üzerinden yayınladığı Verbis zarfını aktarır. Bu köprü (AWS SDK/EventBridge, Finesse/Webex gadget, Flex plugin, Open CTI/CIF adaptörü vb.) depoda yok. Fixture'lar da vendor-native değil. Bu yüzden:

- `HUB_MARKETPLACE_BRIDGE_ENABLED=true` olmadıkça (varsayılan `false`) hub bu adaptörleri **etkinleştirmez**;
- etkinleştirilmeyen connector'ı supervisor `down` olarak, `unsupported adapter on this hub` gerekçesiyle raporlar;
- gerçek bir köprü vendor sandbox'ında sözleşme testini geçene kadar bu platformlar için write-back, wrap-up ve kayıt kontrolü **ilan edilmez**.

CRM'ler CTI sağlayıcısı değildir ve CRM kayıt sahipliği launch kanıtı olamaz. Tüm connector'lar transfer, end ve freshness kontrollerini uygular ve server bridge üzerinden yeniden doğrular. Flex/CRM generic kind'ları mevcut DB enum'unu genişletmez. Kurulum için [ortak kurulum](SETUP.md) ve platform rehberlerine bakın.

## Teslim edilemeyen olaylar (DLQ)

Hub, olayı JetStream work-queue stream'i `VERBIS_HUB_DLQ`'ya yazar (dosya depolama, saklama süresi `HUB_DLQ_MAX_AGE_HOURS`, varsayılan 7 gün) şu durumlarda:

- yeniden deneme hakkı bittiğinde;
- API olayı reddettiğinde;
- kapanışta olay hâlâ kuyrukta beklerken.

Ayrıntılar:

- **Subject:** `verbis.connector.event.deadlettered.v1.<tenantId>.<connectorId>`.
- **Üretim:** `HUB_DLQ_NATS_URL` zorunludur.
- **Yeniden oynatma:** API, bir tenant'ın kayıtlarını `POST /internal/v1/dead-letters/replay` ile yeniden oynatır; tenant token'dan alınır.
- **Alarm:** `verbis.connector.event.deadlettered{reason,outcome}` metriği `ConnectorEventDeadLettered` ve `ConnectorDeadLetterLost` alarmlarını besler.
- **Gizlilik:** payload PII içerebilir, bu yüzden loglarda yalnızca id'ler yer alır.
