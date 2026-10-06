# Verbis — gerçek bağlantılı ürün denetimi, 4 Ekim 2026

## Kabul kararı

Kullanıcının eklediği tam proje denetimi talebi doğrultusunda önceki iki denetim genişletildi. Bu turda gerçek frontend → API → PostgreSQL/Redis bağlantısı ve iki farklı kullanıcıyla ortak düzenleme doğrulandı. **Chromium, Firefox ve WebKit'te 32'şer gerçek bağlantılı senaryo geçti; toplam 96 başarılı tarayıcı senaryosu ve 288 son ekran görüntüsü kaydedildi.** Otomatik erişilebilirlik taramalarında kural kaldırılmadı.

Bu bulgu, bütün düğmelerin ve olası iş akışlarının eksiksiz kabul edildiği veya ürünün koşulsuz canlıya hazır olduğu anlamına gelmez. Gerçek müşteri telefon platformuna yazma, gerçek çağrı altında Agent latency, müşteriye özgü IdP politikaları ve AI sağlayıcısıyla üretilen yanıtlar bu yeni tarayıcı süitinde doğrulanmadı. Bunlar “çalışıyor” sayılmadı. Sunucu/prod kurulumu, cluster, deployment ve hosting kullanıcı talebiyle kapsam dışıdır; eksiklik listesine yazılmadı.

Önceki kapsamın ayrıntıları: [ilk ürün denetimi](PRODUCT_AUDIT_2026-10-04.md), [ikinci denetim](PRODUCT_RECHECK_2026-10-04.md). Bu rapor önceki test sayılarını yeni testler gibi toplamaz. Önceki raporlardaki iki kullanıcılı yerel tarayıcı kabulü açığı bu turda kapandı; müşteri ortamında SSO kabulü bununla eşitlenmedi.

## Test ortamı ve kanıt güvenilirliği

- PostgreSQL, Redis ve NATS Testcontainers ile her koşuda yeni, geçici ortamda oluşturuldu; gerçek migration ve en az ayrıcalıklı API DB rolü kullanıldı. Kullanıcının mevcut veritabanına dokunulmadı.
- Üç gerçek Vite uygulaması ve Nest/Fastify API dinamik yerel portlarda çalıştı. Ortak düzenleme gerçek Hocuspocus WebSocket sunucusundan geçti. Testlerde `page.route`/API response mocking bulunmuyor.
- Sentetik kullanıcılar için gerçek SessionStore'da şifreli Redis BFF oturumları oluşturuldu; tarayıcı gerçek httpOnly/secure cookie, CSRF ve uygulama izin mekanizmalarını kullandı. Bu yöntem SSO girişinin kendisini test etmez; gerçek Keycloak OIDC/SAML testleri ayrı çalıştırılır.
- Test düzeneği çok sayıda bağımsız oturum açtığında hassas endpoint'in 20/dakika IP limiti beklendiği gibi HTTP 429 verdi. Üretim limiti değiştirilmedi. Senaryolar arasında yalnız bu koşuya ait izole Redis hız sayaçları ve test kullanıcısının oturumları temizlendi; normal request limitleri koşu boyunca etkin kaldı.
- 320, 390, 768 ve 1440 piksel genişlikleri kullanıldı. Ana/ayrıntı sayfa taraması 320, 768 ve 1440; uygulama başlangıcı ayrıca 390 pikselde doğrulandı. Editörde seçilmiş düğümün özellik panelinin ekran içinde kaldığı kontrol edildi. Belge taşması `overflow:hidden` ile gizlenerek geçirilmedi.
- Kanıtlarda cookie, parola, CSRF değeri veya request header'ı saklanmıyor. [Kanıt dizini](evidence/product-real-browser-20261004/manifest.json) dosya boyutlarını ve SHA-256 hash'lerini içerir. Ekran görüntüleri sentetik veridir.

## Bulunan ve giderilen sorunlar

| ID | Öncelik ve etkisi | Kök neden / düzeltme | Kanıt |
| --- | --- | --- | --- |
| RB-01 | P1: Gerçek ortak düzenleme bağlantısı kopuyor, uzaktaki değişiklikler kullanılamıyordu. | Hocuspocus awareness decoder'ı kendi boş yerel kaydını da map'e ekliyor. Servis bu boş kaydı ikinci istemci kimliği sanıp bağlantıyı reddediyordu. Geçersiz durumlar kimlik sayımından önce ayıklanıyor; iki geçerli kimlik, aynı socket'te ikinci kimlik ve başka socket'in kimliğini ele geçirme hâlâ reddediliyor. | `collaboration-before.log`: yeni regresyon önce başarısız. API 1.819 testi ve üç tarayıcıda gerçek iki kullanıcı akışı başarılı. |
| RB-02 | P2: Designer rail bağlantıları stillerini ve aktif görünümünü kaybediyordu. | Tooltip'in Radix `asChild` trigger'ı NavLink'in fonksiyon tipindeki className'iyle birleşince `dw-nav` sınıfı kayboluyordu. Sabit sınıf ve gerçek `aria-current="page"` CSS seçicisi kullanıldı. | Gezinme regresyonu, gerçek tarayıcı sınıf kontrolü, üç motorun görüntüleri. |
| RB-03 | P2: Admin ve Designer analitik başlığı 320 pikselde sayfayı taşıyordu. | Başlık/ihracat aksiyonları satır kırmayan flex düzeniydi. Küçük genişlikte satır kırma ve daralabilen başlık eklendi. | `product-browser-second.log`; son tüm ana sayfa taramaları. |
| RB-04 | P2: Designer kurum/ortam üst çubuğu, sayfa aksiyonları ve kart görünümü küçük genişlikte taşıyordu. | Dar ekran düzeninde flex içerikler kırılmıyor, kartların minimum genişliği kullanılabilir alanı aşıyordu. Flex wrapping, daralabilen arama ve alana bağlı kart minimumu eklendi. | `product-browser-third.log`, son 32×3 koşu. |
| RB-05 | P2: Agent üst çubuğu 320 pikselde 338 piksele taşıyordu. | Marka, izleme ve ikon aksiyonları tek satıra zorlanıyordu. Mobil üst çubuk ve aksiyonlar kırılabiliyor. | Başlangıç `product-browser-axe` öncesi tarama; son üç motorda agent-320.png. |
| RB-06 | P2: Admin connector mapping butonu ve sağlık sayaçları mobil alandan çıkıyordu. | Uzun buton etiketi satır kırmıyor; üç sayaç sütunu minimum içeriğini koruyordu. Kart butonları kırılıyor; mobil sayaçlar tek sütun. | Son admin-connectors ve admin-systemHealth 320/768/1440 görüntüleri, belge genişliği assertion'ları. |
| RB-07 | P1/P2: Mobil editörde özellik paneli kullanılabilir ekranın dışına itiliyordu. | Sol ve sağ panel sabit grid sütunları küçük toplam alana sığmıyordu; workspace taşan paneli kırpıyordu. 900 piksel altında paneller alt alta; palette bounded, canvas kendi scroll alanını koruyor; toolbar/status kırılıyor. | `product-details-before.log` başarısız; `product-details-after.log` başarılı. Son üç tarayıcıda Layers'tan gerçek düğüm seçilerek inspector bounding box kontrolü. |
| RB-08 | P2: Yayın karşılaştırması ve entegrasyon import ekranı mobilde taşıyordu. | Karşılaştırma grid'inin çocukları minimum içerik genişliğini dayatıyor; native dosya girdisi ve entegrasyon kartları daralamıyordu. İçerik min/max sınırları ve alana bağlı grid minimumları eklendi. | Ayrıntı ekranı before/after; son üç motor. |
| RB-09 | P2: Boş screen/integration listelerinde başlık sırası h1→h3 atlıyordu. | EmptyState sabit h3 üretiyordu. Uygun başlık düzeyi için `headingLevel` eklendi; bu iki üst seviye boş sayfada h2 seçildi. Varsayılan h3 ve diğer kullanımlar korundu. | `product-browser-axe.log` iki heading-order hatası; `product-axe-fixed.log` ve son 96 senaryo. |
| RB-10 | P2: AI kapalı durumda sayfanın ana başlığı kayboluyordu. | Erken return yalnız Alert içeriyordu. Kapalı/bekleyen/hata ekranları başlığı koruyor. | Axe page-has-heading-one başarısızlığı; UI regresyonu ve son üç motor. |
| RB-11 | P1/P2: AI durum endpoint'i 503 verince “kapalı” gösteriliyor ve yeniden deneme yolu sunulmuyordu. | Query error ile enabled=false aynı koşula düşüyordu. Hata ayrı yerelleştirilmiş mesaj ve Retry sunuyor; iyileşen cevap generation formunu açıyor. | `product-ai-before.log` yeni regresyon başarısız; `product-ai-after.log` 6/6 başarılı; monorepo son koşusu. |

## Test edilen iş akışları

Ana sayfalar: Admin analytics, identity, users, connectors, secrets, AI, audit, security, data, branding, simulator, systemHealth; Designer analytics, campaigns, scripts, screens, integrations, variables, AI, templates, releases, settings. Her biri gerçek API, üç cihaz genişliği, erişilebilirlik ve browser exception kontrolünden geçti. Bunlar sayfa yükleme/görünüm kontrolleridir; her sayfanın tüm mutasyonlarını yaptığı iddia edilmez. Sentetik tenant'ta olmayan yetki alanları ve boş vendor/AI entegrasyonu çalışmış gibi sayılmadı.

Ayrıntı sayfaları: script sürüm listesi, editör, release workflow/karşılaştırma, campaign assignments, script packages ve yeni entegrasyon import ekranı. Editörün Layers seçimi ve özellik paneli gerçek etkileşimle denetlendi. Diğer ayrıntı sayfalarında bütün yayın/aktar/sil aksiyonlarının bu süitte çalıştırıldığı iddia edilmez; önceki test kanıtları ayrı katmandır.

Mutasyonlar:

1. Designer “New script” formundan script oluşturuldu; DB'de tenant ve ad doğrulandı. “Create first draft” ile editöre geçildi; DB'de tek sürüm oluştuğu kontrol edildi.
2. Admin branding adı gerçek PATCH ve CSRF ile kaydedildi; PostgreSQL'deki JSON ayarı kontrol edildi, sayfa yenilendi ve aynı değer tekrar okundu.
3. Farklı kullanıcı ID'lerine sahip iki ayrı browser context aynı taslağa katıldı. İlk kullanıcı kural ekledi, ikinci kullanıcı bu uzak kuralı seçip değiştirdi, ilk kullanıcı değeri gördü. İki oda kapandı; reload sonrası peer değeri gerçek kayıt üzerinden korundu. Bu, aynı fixture DOM'unun iki kez gösterilmesi değildir.
4. AI durum 503 → kullanıcı Retry → enabled=true formuna dönüş unit testle doğrulandı. Bu AI sağlayıcı çağrısı/yazma kabulü değildir.

## Yeniden çalıştırma

Depoların mevcut build çıktıları gereklidir; monorepo build bunu üretir. Docker yalnız geçici test bağımlılıkları için kullanılır. Mevcut servis kurulumuna veya gerçek kullanıcının verilerine ihtiyaç yoktur.

```sh
pnpm --filter @verbis/api exec vitest run \
  --config ../../tests/verification/v2.config.mjs product-browser.audit.spec.ts
PRODUCT_BROWSER_ENGINE=firefox pnpm --filter @verbis/api exec vitest run \
  --config ../../tests/verification/v2.config.mjs product-browser.audit.spec.ts
PRODUCT_BROWSER_ENGINE=webkit pnpm --filter @verbis/api exec vitest run \
  --config ../../tests/verification/v2.config.mjs product-browser.audit.spec.ts
```

`PRODUCT_BROWSER_EVIDENCE` yalnız görüntülerin yazılacağı yerel dizini değiştirir. Son süitte skip/quarantine yoktur. Ara teşhis koşularındaki `-t` filtreleri seçilmeyen testleri “skipped” gösterir; yalnız 32/32 tam koşular kabul kanıtıdır.

## Değişen dosyalar

- API: `apps/api/src/modules/scripts/collaboration.service.ts`, `collaboration-hooks.spec.ts`.
- Designer: `src/workspace/shell.tsx`, `styles.css`, `shell-behavior.spec.tsx`; `src/editor/editor.css`; `src/lifecycle/styles.css`; `src/integrations/styles.css`, `list.tsx`; `src/pages/library.tsx`, `ai.tsx`, `ai-behavior.spec.tsx`; `e2e/collaboration-live.spec.ts` (mevcut süitte doğru “Rule builder” accessible adı).
- Admin: `apps/admin-web/src/workspace/workspace.css`. Agent: `apps/agent-web/src/desktop/styles.css`.
- Ortak UI: `packages/ui/src/components/layout.tsx`, `packages/ui/src/tokens.css`.
- Yeni gerçek browser süiti: `tests/verification/product-browser.audit.spec.ts`. Mevcut verification tsconfig'ın DOM lib'i değiştirilmedi; browser evaluate için ayrı string sınırı kullanıldı.

## Açık işlevsel kabul sınırları

- Gerçek telefon platformu event → yetkili launch → datasource → wrap-up → vendor write-back. Yerel adapter/Java/mTLS/contract testleri ve ACK'ler gerçek müşteri platformunun kabulüyle eşit değildir.
- Gerçek çağrı altında Agent desktop latency ve aynı anda çok sayıda çağrı davranışı. Bu turdaki Agent başlangıç görünümü aktif çağrı yürütme kabulü değildir.
- Müşteri özel OIDC/SAML/SCIM politikasının tenant/rol eşlemesi. Yerel Keycloak testleri gerçek protokolleri doğrular, müşteri ayarını doğrulamaz.
- Yetkili gerçek AI sağlayıcısıyla generation; mevcut AI output validation, masking ve hata testleri sağlayıcı sözleşmesinin canlı kabulü değildir.
- Her mevcut JSX düğmesi için tek tek durum/rol/veri matrisiyle kanıt eşlemesi tamamlanmış değildir. Önceki 266 etkileşimli tanım envanteri test sayısıyla bire bir eşleştirilemez.

Bu sınırlar nedeniyle “çalışmayan hiçbir şey yok” veya “tüm akışlar eksiksiz üretim kabulünden geçti” beyanı verilmedi. Kaynakta bulunan ve burada tekrarlanabilen sorunlar düzeltildi; dış kabul kanıtı gerektiren özellikler belirsiz olarak açık tutuldu.

## Son genel doğrulama

| Kontrol | Sonuç | Kanıt |
| --- | --- | --- |
| Monorepo test + lint + typecheck + build | 77/77 görev başarılı; 41 aynı kaynak hash'inden cache hit, 36 görev yeniden çalıştı | `product-all-accepted.log` |
| Vitest, 18 runtime workspace | 4.957 başarılı; API 1.819, Designer 307, Admin 100, Agent 125, hub 629 | Aynı log; tekrar koşuları bu sayıya eklenmedi |
| Docs Node testleri | 4 başarılı | Aynı log |
| Gerçek ürün browser süiti | Chromium 32/32, Firefox 32/32, WebKit 32/32; tam koşularda 0 skip | `product-browser-*-accepted.log` |
| Gerçek backend/Keycloak/TLS/WebSocket | 275/275, beş dosya | `product-backend-accepted.log` |
| Coverage kapısı | 18 workspace başarılı; kritik API güvenlik scope eşikleri korunuyor | `product-coverage-accepted.log` |
| Yeni verification TS kontrolü | Başarılı | `product-verification-type-final.log` |
| Test tip kontrolü / lint ve root ESLint | Başarılı | `product-test-type-final.log`, `product-test-lint-final.log`, `product-root-lint-final.log` |
| Repo format ve diff whitespace | Başarılı | `product-format-final.log`, `product-diff-final.log`, `product-report-check-final.log` |

Son satır/branch coverage: API %92,88 / %85,56; Designer %91,50 / %80,37; Admin %94,61 / %88,17; Agent %93,52 / %84,91. Test kapsamı %100 değildir; geçen test sayısı mutlak kusursuzluk iddiası taşımaz.

Derleme çıkışında mevcut büyük bundle uyarıları ve docs test görevinin output cache uyarısı bulunuyor; bunlar fatal hata değildir, performans optimizasyonu gereksinimini ortadan kaldırmaz. Son başarılı genel koşu kaynak değişiklikleri bittikten sonra tamamlandı. Önceki monorepo koşusu, AI regresyonu henüz düzeltilmeden test dosyasını aldığı için 31/32 ile başarısızdı; o koşu kabul sonucu sayılmadı. Başarısız/teşhis kanıtları saklandı. Test eşikleri, axe kuralları veya güvenlik kontrolleri gevşetilmedi.
