# Verbis — gerçek Agent akışı ve son ürün regresyonu, 5 Ekim 2026

## Kabul kararı

Bu turda iki kritik işlevsel bağlantı ve aktif Agent ekranındaki erişilebilirlik yapısı düzeltildi. Gerçek yerel çağrı zinciri artık normal Agent rolüyle Chromium, Firefox ve WebKit'te sonuç kaydına ve connector başarı onayına kadar doğrulanıyor. Bu, önceki raporların açık bıraktığı **yerel aktif Agent ve gerçek hub write-back** kabulünü kapatır.

**Bütün ürün için koşulsuz ve eksiksiz canlı kabul verilmiyor.** Müşterinin lisanslı telefon platformları, müşteri IdP politikaları, canlı AI ve ödeme/token sağlayıcıları için yetkili uçlar yok. Mevcut kanıtlar bu sistemlerle çalışmayı veya her düğmenin bütün rol/veri/ağ kombinasyonlarını doğrulamaz. Sunucu/prod altyapısı, cluster, hosting ve deployment kullanıcının talebiyle kapsam dışıdır; bu alanlar ürün hatası olarak sayılmadı.

Önceki kapsam ve ayrıntılı modül envanterleri: [ilk ürün denetimi](PRODUCT_AUDIT_2026-10-04.md), [ikinci işlevsellik kontrolü](PRODUCT_RECHECK_2026-10-04.md), [gerçek API bağlı tarayıcı denetimi](PRODUCT_REAL_BROWSER_2026-10-04.md). Bu rapor o kayıtların tarihsel sonuçlarını değiştirmez; yeni kanıtı ve kapanan açıkları belirtir.

## Bulgular, nedenler ve çözümler

| Kimlik | Önem ve etki | Neden ve değişiklik | Doğrulama |
| --- | --- | --- | --- |
| AG-01 | P1 — tamamlanan çağrının sonucu platforma yazılamıyor; kayıt duraklatma/devam komutları da connector bulamıyordu. | `RuntimeJobsService`, `RuntimePorts.connector()` çağırıyor fakat uygulama başlatılırken herhangi bir runtime connector kaydı yapılmıyordu. `HubRuntimeBridge` tenant kimlikli ve imzalı `HubClient` üzerinden `writeAttributes`, `setWrapUp`, `pauseRecording`, `resumeRecording` komutlarını bağlar. Açıkça kaydedilmiş connector önceliğini korur. | Sekiz yeni unit regresyonu; normal Agent rolü, gerçek hub/mTLS/OAuth ve BullMQ ile üç tarayıcıda gerçek sonuç ve kayıt komutları. |
| AG-02 | P1 — simülatör çağrısı geliyor fakat kampanyaya atanmış script açılmıyor. | Simülatör `queue` gönderiyor, kampanya dış eşleştirmesinin kullandığı `campaignRef` gönderilmiyordu. Dolu kuyruğun `kind: queue` referansı bütün yaşam döngüsü olaylarına eklenir. Boş/eksik kuyruk referans üretmez. | Başlangıçta gerçek redeem `422 VERBIS_LAUNCH_NO_ASSIGNMENT`; yeni regresyon düzeltmeden önce başarısız. Düzeltme sonrası unit, gerçek kampanya/assignment ve üç tarayıcı launch geçti. |
| AG-03 | P2 — aktif çağrıda ana içerik bir başka isimli landmark içinde; çağrı sekmeleri ve panel içeriği landmark dışında. | Aktif etkileşimlerin tamamı üst düzey `main` içine alınır. Script'in odaklanılabilir iç konteyneri `div` olur; mevcut skip-link hedefi ve CSS sınıfı korunur. | Önce axe `landmark-main-is-top-level` ve `region` ihlalleri; sonra aktif, wrap-up ve tamamlanma durumlarında üç tarayıcı axe taramaları temiz. |

İlgili kaynaklar: `apps/api/src/modules/connectors/hub-runtime-bridge.ts`, aynı dizindeki `.spec.ts` ve `connectors.module.ts`; `apps/api/src/modules/runtime/runtime-ports.ts`; `apps/connector-hub/src/connectors/simulator/simulator.connector.ts` ve `.spec.ts`; `apps/agent-web/src/desktop/workspace.tsx`, `session-view.tsx`.

Bridge bütün attribute ve wrap-up girdilerini ilk dış çağrıdan önce SDK şemasıyla doğrular. Yapısal değerler JSON olarak gönderilir; callback zamanı attribute'a aktarılır. Kısmi hata başarı olarak yutulmaz. Attribute ve wrap-up için farklı ama retry boyunca sabit komut kimlikleri kullanılır; connector'ın deduplikasyonu korunur. Başarı audit'i mevcut worker tarafından ancak hub çağrıları tamamlandıktan sonra yazılır. Hub yapılandırılmadığında bağlantı açılmaz; tenant sınırları ve yetkilendirme kontrolleri korunur.

## Gerçek uçtan uca test

Tekrar çalıştırılabilir kaynak: `tests/verification/agent-live-local.audit.spec.ts`.

1. İzole PostgreSQL 16, Redis 7 ve NATS JetStream başlatılır; bütün migration'lar ve kısıtlı uygulama DB rolü uygulanır.
2. Gerçek API üzerinden script oluşturulur, ilk sürüm submit edilir, ayrı kullanıcıyla onaylanıp yayımlanır; aktif kampanya, generic kuyruk eşleştirmesi ve pinned assignment oluşturulur.
3. Her tarayıcı için ayrı normal Agent kullanıcısı ve kampanya scope'u atanır. Yönetici kontrollerinin görünmediği doğrulanır. Sentetik SSO cookie'si gerçek SessionStore tarafından üretilir; bu cookie kurulumu IdP login testi değildir. Gerçek Keycloak giriş/çıkış kabulü ayrı süittedir.
4. Gerçek hub, HTTP API taklidi kullanılmadan başlatılır. Geçici CA/server/client sertifikalarıyla TLS istemci doğrulaması ve sertifikaya bağlı OAuth kullanılır. Yerel TLS edge, istemcinin taşıdığı cert header'ını kabul etmez; doğrulanmış peer sertifikasından kendisi üretir.
5. Agent bekleme ekranı ve connector socket bağlantısı doğrulanır. Yönetici gerçek API'den simülatör çağrısını üretir. Hub event → mTLS ingestion → kullanıcı/kampanya eşleştirme → launch intent → transactional outbox → NATS → browser socket → redeem → runtime zinciri kendiliğinden script'i açar.
6. Aktif ekran 390, 768 ve 1440 px genişliklerinde taşma ve ekran görüntüsü kontrolünden geçer; axe ihlali olmamalıdır. Aynı oturumun ikinci sekmesi salt okunur kalır ve ilerleyemez.
7. Normal Agent'ın writer lease'iyle gerçek recording endpoint'ine pause/resume gönderilir; hub simülatörünün aldığı gerçek komutlar beklenir. Platform hold/resume olayları UI'ı günceller; bekletmede Next kapalı, devam etmede açık olmalıdır.
8. Script'in gerçek metin alanına değer girilir; gerçek runtime GET aynı kalıcı değeri dönmelidir. Next → wrap-up → Success → zorunlu not → Submit outcome akışı çalıştırılır. Not yokken gönderim kapalıdır.
9. DB outcome tek kayıttır; desktop writeback `success` olur. Hub snapshot'ında aynı çağrıya ait gerçek `writeAttributes` payload'ı ve `setWrapUp` komutu bulunmalıdır. Tamamlanma yenilemeden sonra korunur; axe ve browser exception kontrolü geçer.
10. Geçici çağrı bitirilir; browser, Vite, hub, API, DB bağlantısı ve özel sertifika dizini kapatılır. Gerçek kullanıcı DB'si ve root `.env` kullanılmaz.

Aktif çağrı ve write-back süreleri [measurements.json](evidence/agent-live-local-20261005/measurements.json) içindedir. Her akışta 10 saniyelik üst sınır assertion'ı vardır. Bunlar sentetik tek çağrı ve yerel ortam gözlemleridir; üretim yük testi, p95/p99 veya gerçek vendor latency garantisi değildir. Görsel kanıtlar [kanıt dizininde](evidence/agent-live-local-20261005/) saklanır.

## Son doğrulama sonuçları

Nihai sonuçlar ve log hash'leri kanıt dizinindeki `manifest.json` içine yazılır. Ara başarısız koşular nihai kabul olarak sayılmaz. Benzersiz testler ve tekrarlar birbirine eklenmez.

| Katman | Sonuç |
| --- | --- |
| Bütün monorepo test/lint/typecheck/build | 77/77 görev; 4.966 Vitest + 4 docs Node testi |
| Gerçek backend/Keycloak/TLS/WebSocket, gerçek ürün Chromium ve üç Agent tarayıcısı | 7 dosya, 310 test; nihai log manifest'te |
| Gerçek ürün Firefox/WebKit | Her biri 32 senaryo; nihai log manifest'te |
| Yeni Agent gerçek çağrı süiti | 3/3; skip yok; field write-back, recording, hold/resume, lease, responsive ve axe dahil |
| Coverage | 18 workspace ve kritik dizin kapıları |
| Yeni verification kaynağı | Ayrı TypeScript ve tip denetimli ESLint; format ve whitespace kontrolü |

Coverage bir işlevsel kabul yüzdesi değildir. API satır %92,89 / branch %85,61; Agent %93,52 / %84,91; Admin %94,61 / %88,17; Designer %91,50 / %80,37; connector-hub %86,40 / %75,17. Yeni bridge ve simülatör regresyonları bu değerlere dahildir. Mevcut büyük bundle uyarıları performans optimizasyonu fırsatı olarak kalır.

## Test koşularında düzeltilen izolasyon sorunları

- İlk yeni harness koşularında sentetik test anahtarının export yetkisi, kampanya outcome şeması ve doğru endpoint/etiket seçimi düzeltildi; bunlar ürün hatası sayılmadı. Başarısız loglar saklandı.
- İlk genel koşu yeni testin exact optional property kullanımını, sonraki koşu import sıralamasını reddetti; test kaynakları düzeltildi, başarılı tam koşu tekrarlandı.
- Paylaşılan geçici Redis'te önceki süitler hassas `/auth` IP limitini tüketebiliyor. Bağımsız browser vakalarının başlangıcında yalnız bu disposable Redis'in rate-limit sayaçları sıfırlanır. Uygulamanın hız sınırı kodu, CSRF, SSO, mTLS, tenant/RLS, writer lease ve axe kuralları değiştirilmedi. İlk toplu koşu 308/310 idi; temiz tam koşu 310/310 oldu.
- Verification harness birden fazla uygulamayı test için aynı süreçte birleştirir. Yalnız bu test dizinindeki ESLint yapılandırması uygulama-import yasağından muaftır; üretim uygulamalarında bağımlılık yasağı sürer. Diğer tip/güvenlik lint kuralları açık kaldı.

## Açık işlevsel kabul sınırları

| Alan | Yerel kanıt | Henüz kanıtlanmayan |
| --- | --- | --- |
| Genesys/Avaya/marketplace telefon sistemleri | Connector contract/replay, gerçek yerel hub ve simülatör komutları | Yetkili gerçek platformda event/launch/data source/write-back ve lisanslı SDK yolları |
| Kimlik | Gerçek Keycloak; OIDC/SAML/SCIM, mTLS, tenant ve authorization entegrasyonları | Müşterinin Entra/Okta/SAML/SCIM politikaları ve sertifika yaşam döngüsü |
| AI ve PCI token sağlayıcısı | Şema, hata/timeout, yetki, maskelenmiş veri ve provider-verification regresyonları | Gerçek sağlayıcı yanıt kalitesi, dış veri yerleşimi ve gerçek ödeme kabulü |
| Bütün buton/rol/durum matrisi | Önceki etkileşim envanteri, app davranış süitleri, gerçek ana/ayrıntı ekranları ve bu çağrı akışı | Her kombinasyonun bağımsız gerçek browser kanıtı; test sayısı bunu garanti etmez |
| Performans/erişilebilirlik | Yerel çağrı süreleri, responsive/axe, mevcut benchmark ve klavye süitleri | Gerçek trafik altında soak/p95/p99 ve manuel VoiceOver/NVDA kabulü |

Bu alanlar test edilmeden başarılı olarak işaretlenmedi. Düzeltilen ve yerelde tekrar üretilebilen bulgular kapatıldı; ürünün bütünü için eksiksiz canlı kabul bu açıkların gerçek kanıtla kapanmasını gerektirir. Commit, deploy veya gerçek veri değişikliği yapılmadı.

## Yeniden çalıştırma

```sh
pnpm exec turbo run test lint typecheck build --concurrency=1
pnpm --filter @verbis/api exec vitest run --config ../../tests/verification/v2.config.mjs
PRODUCT_BROWSER_ENGINE=firefox pnpm --filter @verbis/api exec vitest run --config ../../tests/verification/v2.config.mjs product-browser.audit.spec.ts
PRODUCT_BROWSER_ENGINE=webkit pnpm --filter @verbis/api exec vitest run --config ../../tests/verification/v2.config.mjs product-browser.audit.spec.ts
pnpm exec tsc -p tests/verification/tsconfig.json --noEmit
pnpm exec eslint --config tests/verification/eslint.config.mjs tests/verification/agent-live-local.audit.spec.ts
pnpm coverage:check
```

Docker ve kurulu Playwright tarayıcıları gerekir. `PRODUCT_BROWSER_EVIDENCE` ürün ekran görüntülerinin dizinini seçer; yeni Agent testinin kanıtları tarihli dizine yazılır. Private key, cookie, access token veya writer token çıktıya/rapora yazılmaz.
