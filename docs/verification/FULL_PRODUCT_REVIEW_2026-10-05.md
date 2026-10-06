# Verbis ürün ve tasarım denetimi — 5 Ekim 2026

## Kapsam ve karar

Designer, Admin, Agent, ortak UI/bileşenler, güvenli runtime, API, connector hub ve TR/EN dokümantasyon incelendi. Sunucuyu production ortamına hazırlama, deployment ve mevcut kullanıcı verisini değiştirme kapsam dışında tutuldu. Mevcut geliştirme süreçleri ve veri korundu. Gerçek backend kabulü ayrı Testcontainers veritabanı/Redis/NATS, sentetik tenantlar ve BFF oturumları üzerinden yürütüldü.

Bu çalışma ürünün doğrulanmış davranışlarını ve bulunan hataların kapanışını belgeler. Evrensel sıfır-hata, gelecekte hiç tasarım değişikliği gerekmemesi veya gerçek sağlayıcı kabulünün tamamlandığı anlamına gelmez. Sonuç yalnızca yürütülen testler ve gözlenen durumlar için geçerlidir.

## Düzeltmeler

| Sorun | Son davranış | Kanıt |
| --- | --- | --- |
| Kampanya okuyucusu erişemediği şablon ekranına yönlendiriliyordu | Şablon tanıtımı ve düğmesi `read:Script` yetkisine bağlıdır | Başarısız → başarılı birim regresyonu |
| Sonuç yokken kullanıcı bütün filtreleri elle geri almak zorundaydı; yeni içerik oluşturma eylemi öneriliyordu | Tek düğmeyle arama/durum/etiket/sahip filtreleri temizlenir; filtrelenmiş boşlukta mevcut içeriğe dönme açıklaması gösterilir | Bileşik filtre + temizleme regresyonları, tarayıcı senaryosu |
| Sonraki sayfa yüklenemeyince yüklenmiş liste yerini genel hata ekranına bırakıyordu | Liste, görünüm ve filtreler korunur; hata içinde aynı sonraki sayfa yeniden denenir | Başarısız → başarılı birim testi; otomatik retry dahil browser arızası |
| Yenileme hatası ile korunmuş verinin güncel olduğu izlenimi oluşabiliyordu | Son yüklenen sonuçların gösterildiği bildirilir; retry güncel veriyi getirir | Stale veri ve toparlanma regresyonu |
| Kullanıcı menüsünden rehber yeniden açılınca ortadan başlıyordu | Menüden tekrar açılış da ilk adımı gösterir | Başarısız → başarılı rehber regresyonu |
| Küçük menü yazıları, farklı paletler ve kısa pencerede taşan menü | Masaüstünde 216px okunabilir metinli gezinme, dar ekranda kompakt menü, menü içinde dikey kaydırma, ortak lacivert/mavi tokenlar | 320/768/1440 × 600px klavye ulaşılabilirliği, responsive/axe, görüntü incelemesi |
| Yeni seçili menü yüzeyinde kontrast 4,38:1'e düşüyordu | Seçili yüzey açıklaştırıldı; ikon, metin ve gösterge birlikte korunur | İlk axe koşusunda bulundu; son koşular ayrıca doğrulanır |

Bölümler arası filtre taşınması başlangıç incelemesinde şüpheydi; regresyon testi mevcut route sınırının zaten durumu temizlediğini gösterdi. Bu davranış düzeltilmiş hata olarak sayılmaz. Kullanıcı verisine yazan yeni bir domain işlemi eklenmedi; mevcut API yetki, CSRF, sürüm ve audit sınırları korundu.

## Tasarım

Giriş ekranındaki midnight blue yönü ortak light/dark tokenlara taşındı. Designer menüsünde 10px ikon altı metin yerine okunabilir yatay metin ve marka alanı kullanılır; dar ekranda 11px kompakt etiketler korunur. Üst çubuk ve yan menü beyaz/koyu yüzeylerde tutarlıdır. Kampanya tanıtımı sadeleştirildi; kartlarda uzun içerik ve dipnotlar sarılır. Yüksek kontrast ve reduced-motion davranışları korunur. Görsel beklentiler değiştirilmeden önce davranış/axe sonuçları incelendi; yeni Designer light/dark referansları ayrıca görsel kontrol edildi.

## Kabul matrisi

Son komutların sonuçları aşağıdaki tabloda kaydedilir. Aynı testin teşhis/yeniden koşuları benzersiz test sayısı gibi toplanmaz.

| Kontrol | Sonuç |
| --- | --- |
| Monorepo lint/typecheck/build/test | 77/77 görev; 4.988 Vitest + 4 Node docs = 4.992 test; son koşuda 67 geçerli cache, 10 yeniden yürütülen görev |
| Coverage gate | 18/18 workspace ve güvenlik kapsamı kapıları geçti; eşikler düşürülmedi |
| Gerçek API/IdP/TLS/WebSocket/Agent/Chromium ürün kabulü | Son kaynak ve tasarımla 322/322, skip 0 |
| Ürün WebKit/Firefox son tasarım | Her tarayıcıda 44/44, skip 0 |
| Designer tam Chromium UI süiti | Son kaynakla 65/65, skip 0; güncel referanslarla normal kıyas |
| Admin Chromium | 18/18 |
| Agent Chromium | 24 başarılı, 2 açıkça koşula bağlı skip |
| Bileşenler: üç tema, klavye/axe, TR/EN/RTL | 208/208 |
| UI tasarım sistemi görsel/axe | 161 tasarım sistemi vakası + 6 analytics vakası başarılı; son analytics hedefli kıyas 6/6 |
| Docs Chromium/Firefox/WebKit, TR/EN | 12/12 |
| 500 düğüm runtime performansı ve axe | 2/2; ilk çizim <100ms, input p95 <16ms |
| Audit/çeviri, policy, test TS/lint ve root script lint | Audit 2/2, policy 5/5; TS/lint başarılı |
| Bağımlılık güvenliği | Raw audit 2 high, 0 critical; doğrulanmış mevcut yerel yama sonrası çözümsüz high/critical 0; saldırı regresyonu 6/6 |

Gerçek ürün matrisi 12 Admin ve 10 Designer bölümünü, script/editor/release/assignment/package/integration ayrıntılarını, 320–1440px düzenleri, gerçek script ve ilk taslak oluşturmayı, campaign_manager ile kampanya durum/sonuç gerekliliklerini, 412 sürüm çatışmasında form korumayı, secret kaydetme/rotasyonunu, 10 tenant rolünü, branding reload ve iki kullanıcıyla collaboration flush/reload davranışını içerir. Ana monorepo testleri API entegrasyonları, tenant izolasyonu, yetki, expression/runtime, connector sözleşmeleri, schema ve i18n katmanlarını içerir.

Son başarılı kalite komutu `pnpm exec turbo run lint typecheck build test --concurrency=1 --continue=dependencies-successful --output-logs=errors-only` oldu. Root script lint, audit/policy ve test TS/lint ayrıca çalıştırıldı. Designer son birim testi 327/327; API 1.828/1.828. Yeni/değişen kaynak dosyalarının Prettier kontrolü geçti. Cache sonuçları aynı kaynak ve bağımlılık hashlerine aittir; tüm görevlerin son koşuda sıfırdan yürütüldüğü iddia edilmez.

## Teşhis koşuları

- Başlangıç full quality koşusu Designer branch coverage 79,94 ile kapıda kaldı. Yeni hata senaryoları eklendi; eşik düşürülmedi.
- Sonraki yoğun eşzamanlı koşuda 5 saniyelik Designer editör testi timeout oldu; ayrıca yeni testte generic type lint hatası görüldü. Testte generic kullanımı düzeltildi; ürün timeout/coverage/erişilebilirlik kuralları gevşetilmedi. Admin’de de 13 eşzamanlı JSDOM dosyası iki testin 5s sınırını aşmasına neden oldu; Designer ile aynı iki işçi sınırı uygulandı. Süre/coverage eşikleri değişmedi. Son kabul daha az eşzamanlı iş ile yapılır.
- Mevcut dev portunu kullanan fixture E2E koşusunda `**/api/**` test interceptor'ı `/src/api/client.ts` modülünü JSON olarak yanıtladı; boş sayfa ürünün gerçek API kabulünde oluşmadı. Bu koşu başarı sayılmadı. Ayrı preview portları (5183/5184/5185) kullanıldı; kullanıcının 5173–5175 süreçleri kapatılmadı.
- İlk yeni palet ile axe seçili menü kontrastını buldu; CSS düzeltildi. Eski referansla görsel fark bekleniyordu; yeni light/dark referansları incelendi.
- Yeni pagination testinin ilk arızası, uygulamanın bir otomatik retry ile zaten toparlanmasıydı. Test hem ilk isteği hem bu otomatik retry'ı başarısız yapacak şekilde düzeltildi; uygulamanın retry politikası değiştirilmedi.
- UI Storybook ilk çok işçili koşuda soğuk yükleme/stabil görüntü timeoutları verdi. Tek işçili, sıfır retry ile tam tekrar yapıldı; başarısız koşu ayrı log olarak saklandı.
- Tek işçili UI tekrarındaki kalan bir görsel fark, native tarih alanının seçili segment/focus vurgusuydu. Klavye odağı ve axe doğrulaması korundu; görsel referanstan önce başlığa odak dışı tıklama ile native seçim temizlendi. Altı TR/EN/tema referansı incelendi ve güncellendi; normal kıyas koşusu 6/6 geçti.
- Outbox entegrasyonunda uygulama ve PostgreSQL saat farkı nedeniyle ilk publish denemesi henüz due olmayan iki olayı claim edemedi. Bu senaryo için yalnız sentetik fixture olaylarının `availableAt` değeri explicit geçmişe alındı; gerçek backoff, dead-letter ve requeue beklentileri değişmedi. Hedefli altı entegrasyon testi geçti; production relay kodu değiştirilmedi.
- Docs 5176 kullanıcı süreciyle doluydu. Ayrı 5186 preview konfigürasyonu ile üç tarayıcı kontrolü yapıldı.

Mevcut `extract-zip` güvenlik yaması hash/config ve altı gerçek kurulu-paket saldırı regresyonuyla doğrulandı. Raw audit kayıtları silinmedi; mevcut istisna 3 Kasım 2026 tarihinde sona erer. Bağımlılık raporu ve doğrulama logu kanıt dizinindedir.

## Açık doğrulama sınırları

Lisanslı Genesys/Avaya/Engage müşteri uçları, müşterinin gerçek IdP politikaları ve canlı AI/PCI sağlayıcıları için yetkili dış ortam kabulü bu çalışmada yoktur. Yerel connector/IdP/TLS/WS ve sözleşme testleri bunların gerçek kabulü yerine yazılmaz. Üretim yükü, ağ gecikmesi ve aktif müşteri oturumunda performans için koşulsuz kabul verilmez. Agent opt-in canlı performans testi için storage-state/aktif session sağlanmadığından atlandı; production edge CSP testi de kapsam dışı production edge gerektirir. Bunlar 24 başarılı Agent testine eklenmedi. İlk 322 gerçek kabuldeki sentetik hesap/yerel hub akışı ayrı kanıttır.

## Kanıt

`docs/verification/evidence/full-product-review-20261005/` altında komut logları, üç tarayıcıdaki gerçek ürün ekranları, Designer referans görüntüleri, son kaynak hashleri ve manifest bulunur. Önceki raporlardaki test sayıları bu çalışmanın sonucuna tekrar eklenmez. Deployment yapılmadı ve Git commit/push oluşturulmadı.
