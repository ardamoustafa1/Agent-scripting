# Verbis — ürün işlevselliği denetimi, 2026-10-04

## Sonuç ve kapsam

**Son yerel kalite kapıları geçti. Denetimde bulunan ürün hataları düzeltildi ve regresyonlarla doğrulandı.** Sunucu/prod kurulumu, deployment, cluster, image yayınlama ve canlı altyapı hazırlığı kullanıcının isteğiyle kapsam dışı tutuldu. Ürün kodu; Admin, Designer, Agent, ortak UI/component/runtime, API, connector-hub, iki Java sidecar ve dokümantasyon üzerinden incelendi.

Bu rapor “her olası veri, rol, ağ ve vendor kombinasyonunda sıfır hata” sertifikası değildir. Ana uygulamaların tarayıcı testleri sentetik API yanıtları kullanır; gerçek backend ve IdP ayrı entegrasyon/denetim testlerinde çalıştırıldı. Gerçek müşteri platformuna bağlı tam zincir ve iki yetkili kullanıcının gerçek Designer ekranları arasındaki canlı kabul henüz doğrulanmadı. Bunlar aşağıda açıkça listelenmiştir. Önceki V1/V2 raporlarının başarısız başlangıç koşuları tarihsel kanıttır; bu rapor mevcut kaynak ve bu koşunun sonuçlarını anlatır.

Ortam: macOS arm64, Node 24.11.1, pnpm 9.15.4, kurulu Turbo 2.11.6; Chromium, WebKit ve Firefox. Java testleri Docker içindeki Gradle 8.14 / JDK 21 ile yürütüldü. Backend fixture'ları ayrı Testcontainers PostgreSQL 16, Redis 7 ve NATS JetStream; kimlik testleri ayrı Keycloak 26.8.0 kullandı. Mevcut kullanıcı veritabanı sıfırlanmadı; deploy/commit yapılmadı.

## Bulunan ve düzeltilen ürün sorunları

| Öncelik | Sorun ve kullanıcı etkisi | Düzeltme ve kanıt |
|---|---|---|
| P1 | Agent çıkış isteği başarısız olduğunda hata görünmüyor, promise reddi yönetilmiyordu. | İşlem durumu ve görünür hata eklendi; başarısızlıkta açık iş korunuyor ve tekrar denemeye izin veriliyor. Başarılı çıkışta vault/cache temizliği korunuyor. Unit ve browser hata/tekrar testleri geçti. |
| P1 | Tenant adı değiştirildikten sonra önceki SSO sağlayıcıları veya geç gelen eski keşif yanıtı gösterilebiliyordu. | Girdi değişince eski sonuçlar temizleniyor; keşif nesliyle eski async yanıtlar ve unmount sonrası sonuçlar yok sayılıyor. İki yarış koşulu regresyonu geçti. |
| P1 | Admin'de devre dışı veya işlemdeki form submit olayını yine çalıştırabiliyordu. | Submit handler artık `disabled` ve `busy` durumlarını kontrol ediyor. Programatik submit regresyonu geçti. Bu bulgu backend yetki kontrolünün aşıldığı anlamına gelmez. |
| P2 | Admin listesi başka kaynağa geçince önceki kaynağın sayfalama cursor'ını taşıyabiliyordu. | Cursor kaynak yolu ile eşleştirildi ve yol değişiminde ilk sayfaya dönülüyor. Aynı bağlı bileşende kaynak değiştirme testi geçti. |
| P1 | Yayınlanmış script sonrasında yeni taslak oluşturmak için kullanılabilir giriş noktası yoktu. | Yetkili kullanıcı son sürümden yeni taslak açabiliyor; belge ve paylaşılan ekran sürüm pin'leri taşınıyor, idempotency ve CSRF korunuyor. TR/EN etiket, unit ve üç tarayıcı regresyonu geçti. |
| P2 | Safari/WebKit'te Tab ile “içeriğe geç” bağlantısına ulaşılamıyordu. | Admin, Designer, Agent ve ortak AppShell skip bağlantısına açık `tabIndex=0` eklendi. Admin WebKit/Firefox klavye ve erişilebilirlik koşuları 24/24 geçti. |
| P1 | Designer cihaz önizlemesinde WebKit, Next gibi gerçek runtime butonlarının React olaylarını engelliyordu. | Sabit `srcDoc`, kontrollü frame yüklenmesi ve `script-src 'none'` CSP eklendi; sandbox üst pencerenin olay işleyicilerini çalıştırıyor. Çerçeveye eklenen script ve inline `onclick` canary'leri çalışmıyor; gerçek Next/state restore ve üç tema axe kontrolleri üç tarayıcıda geçti. Politika [önizleme belgesinde](../DESIGNER_PREVIEW.md) açıklandı. |
| P1 | Akış editöründe otomatik düzenleme düğümleri görünür alanın dışına taşıyabiliyor; gövde minimum yüksekliği alt alanı kırpabiliyordu. | Düzenleme sonrasında görünüm düğümlere sığdırılıyor; gövde mevcut yüksekliğe uyuyor. Sürükleme gerçekten pozisyon değiştiriyor, tek Undo eski pozisyonu getiriyor, Page çift tıklaması canvas'ı açıyor. Chromium/WebKit/Firefox'ta geçti. |
| P2 | Büyük canvas render ağacı drag context güncellemelerinde gereksiz yere yeniden render ediliyordu. | Değişmeyen runtime ağacı memo ile korundu. 1.000 düğümlü drag ve 500 düğümlü runtime performans kontrolleri geçti; belge değişimindeki güncellemeler korunuyor. |

Başlangıçtaki başarısız regresyonlar ve son çıktılar [kanıt dizininde](evidence/product-audit-20261004/) tutuldu. Sayfa akışları, hata geri bildirimi ve yetki kontrolleri üzerine yapılan düzeltmeler mevcut genel testleri de geçti.

## Test altyapısındaki bulgular

- Storybook'un otomatik axe eklentisi ile Playwright axe aynı anda çalışabiliyor, “axe already running” hatası üretiyordu. E2E server'ında yalnızca otomatik addon devre dışı; bütün Playwright axe assertions ve etkileşimli Storybook addon'u korunuyor. UI koşusu 167/167 geçti. Görsel toleranslar ve baselines gevşetilmedi.
- Tamper testi sunucu reddi beklerken yerelde parse edilmeyecek token kullanıyordu. Sentaktik olarak geçerli fakat geçersiz imzalı tokenla sunucu reddi ayrıca, bozuk materyalin yerel reddi ayrıca test ediliyor.
- Flow testi async ELK düzenlemesini beklemiyordu ve sabit piksel koordinatlarıyla gerçek düğüm sınırının dışında sürükleyebiliyordu. Düzenlemenin bitmesi, düğüm içindeki hedef ve pozisyonun Undo ile dönüşü kontrol ediliyor. Seçimden kaynaklanan z-index değişimi pozisyon değişimi sayılmıyor.
- WebKit tek frame timestamp'ini milisaniyeye yuvarlıyor; `1000 / 17` hesabı gerçek 60 Hz çalışmayı 58,82 FPS gösterebiliyor. Sürdürülen FPS 120 frame'in toplam süresinden ölçülüyor. DOM'u her mouse move'da serialize eden trace bu benchmark için kapalı; ham frame dizisi JSON attachment olarak saklanıyor. **Sınırlar aynı: FPS ≥59, p95 <20 ms, layer DOM <80.** İşlev testlerinde trace korunuyor.
- Yoğun eşzamanlı build/browser çalışırken üç Admin unit testi 5 saniyelik timeout'a girdi. Timeout artırılmadı; ayrı Admin koşusu ve son tüm repo koşusu temiz geçti. İlk başarısız çıktı `tests-final.log`, kabul edilen tekrar `tests-verified.log` olarak korunuyor.
- Aynı preview portunu paylaşan test server'larının kapanması diğer koşuyu bozabiliyordu. Çapraz tarayıcı koşuları ayrı portlarla yürütüldü. Docs preview için kurulu Astro'nun server kilidi dikkate alındı; kalıcı E2E yapılandırması kendine ait foreground server'ı başlatıyor.

## Son doğrulama sonuçları

Sayılarda farklı katmanların tekrarları birleştirilerek “benzersiz test” toplamı üretilmedi. Browser ana uygulama koşuları API fixture'larıyla çalışır; gerçek servis kontrolleri ayrı satırlardadır.

| Katman | Son sonuç | Kanıt |
|---|---:|---|
| Tüm monorepo test görevleri | 32/32 görev; 4.940 Vitest + 4 docs Node testi geçti, cache kullanılmadı | `tests-verified.log` |
| Lint + typecheck + build | 58/58 görev geçti; son tekrarın 54 görevi önceki başarılı cache'ten | `quality-accepted.log`; önceki zorlanmış koşular da saklandı |
| Repo script testleri | 15/15 | `tooling-verified.log` |
| Coverage policy testleri / audit inventory testleri | 5/5 ve 2/2 | `policy-verified.log`, `audit-verified.log` |
| Ek test ve verification typecheck / lint | Geçti | `test-typecheck-verified.log`, `test-lint-verified.log`, `verification-typecheck.log`, `root-lint-verified.log` |
| UI design system — Chromium | 167/167 | `ui-browser-final.log` |
| Runtime components — Chromium | 208/208 | `components-browser.log` |
| Core runtime benchmark / axe — Chromium | 2/2 | `runtime-browser.log` |
| Admin — Chromium / WebKit+Firefox | 14/14; 24/24 | `admin-browser-final.log`, `admin-cross-final.log` |
| Agent — Chromium / WebKit+Firefox | 24 geçti, 3 atlandı; 44 geçti, 4 atlandı | `agent-browser-verified.log`, `agent-cross-verified.log` |
| Designer — Chromium / WebKit+Firefox | 51 geçti, 1 atlandı; 98/98 geçti | `designer-browser-verified.log`, `designer-cross-verified.log` |
| Docs — Chromium/WebKit/Firefox | 12/12 | `docs-browser-verified.log` |
| Gerçek backend/IdP/network denetimi | 275/275; 5 dosya | `verification-verified.log` |
| API throughput + audit chain | 2/2; 100.000 olay / 2,68 sn, yaklaşık 37.361 olay/sn | `api-performance-final.log` |
| Java Avaya / Engage sidecar | 10/10 ve 7/7; gerçek NATS bridge dahil | `avaya-java-final.log`, `engage-java-final.log`, `java-results.json` |
| Docs statik iç bağlantılar | 71 HTML sayfası, 5.066 bağlantı, 0 bozuk hedef/anchor | `docs-links-final.json` |

275 testlik gerçek denetim; HTTP route yabancı tenant/resource denemelerini, runtime WebSocket yeniden bağlanmasını, tarayıcı expression parity'sini, TLS syslog/HTTPS webhook teslimini ve gerçek Keycloak browser OIDC PKCE/SAML login, refresh/logout'u içerir. Yanlış Origin launch 403 reddinde audit kaydı 1; gerçek yerel nginx/Chromium yabancı iframe reddinde audit artışı 1 olarak yeniden gözlendi. Bu nginx fixture'ı production deployment kabulü değildir.

### Fonksiyonel kontrol matrisi

| Alan | Kontrol edilen davranışlar | Katman / sınır |
|---|---|---|
| Admin | Tenant/marka, kampanya ve connector yapılandırması; kullanıcı, manuel/SSO rol ayrımı, scope ve session sonlandırma; OIDC/SAML provider, SCIM credential, break-glass; audit filtre/diff/chain, SIEM CRUD, dead-event requeue, AI/analytics formları | 92 unit/davranış testi; temel navigasyon/klavye/axe üç tarayıcı. Her yönetim formunun her kombinasyonu browser'da tek tek gezilmedi. |
| Designer | Script oluşturma, publish sonrası taslak; palet/layer drag, reorder, undo/redo; flow, kural ve değişken referansları; shared screen pin, paket/versiyon/lifecycle; entegrasyon editörü ve cURL credential reddi; preview/debugger/state restore/scenario; AI insan onayı; erişim reddi | 299 unit/davranış + 51 Chromium ve 49'ar WebKit/Firefox fixture testi. Gerçek iki-browser işbirliği kabulü ayrı canlı lane'de. |
| Agent | Tenant discovery, SSO erişim sınırı, geçersiz/tamper/expired launch; çoklu etkileşim, reconnect/offline/retry, autosave/vault, runtime form/page transition, wrap-up ve hata geri bildirimi; logout/retry, tema/klavye/axe | 125 unit/davranış + ana browser fixture koşuları. Gerçek vendor write-back ayrı kabul gerektirir. |
| Ortak UI/runtime | Form giriş/validation, table/tree/dialog/command/combobox, tarih seçimi, focus/reduced motion; light/dark/high-contrast, TR/EN/RTL; expression/schema/actions/renderer/scenario | UI/component browser testleri Chromium; ana uygulama testleri üç tarayıcı. Axe sonucu manuel ekran okuyucu kabulü yerine geçmez. |
| API / hub | RLS/tenant transaction, authorization, identity, launch/security, SCIM Bulk, script review/publish/regression, data-source/SSRF, audit/outbox/SIEM, analytics/AI, connector sözleşmeleri ve simulator | API 1.818; hub 629; ek gerçek denetim 275. Vendor sözleşme testleri gerçek lisanslı platform kabulü değildir. |
| Dokümantasyon | TR/EN rota eşliği, executable expression örnekleri, OpenAPI eşliği; gerçek search sonuçları/navigasyon, tema/dil; statik iç linkler | 4 Node + 12 browser; dış internet bağlantıları bu taramada doğrulanmadı. |

### Coverage ve envanter sınırı

18 runtime workspace coverage kapısından geçti. Backend kritik launch/authz/audit/egress/transport satır kapıları da geçti.

| Uygulama | Satır | Branch | Function |
|---|---:|---:|---:|
| Admin | %94,77 | %88,29 | %87,20 |
| Agent | %93,52 | %84,91 | %86,44 |
| Designer | %91,18 | %80,16 | %86,73 |
| API | %92,94 | %85,60 | %88,70 |
| Connector hub | %86,40 | %75,14 | %81,71 |

Bu oranlar tüm dalların kapsanmadığını gösterir; “her butonun her durumda kesin çalışması” sonucu çıkarılamaz. Statik audit envanteri 134 mutasyon route'u, gerçek route probe çıktısı 231 route'u içerir. Probe'un 400/401/428/5xx sonucu veya kurulmamış yabancı resource fixture'ı izolasyon ispatı sayılmaz; bütün başarılı mutasyonların audit kaydının eksiksiz olduğu iddia edilmez. TR/EN envanterinde 716 literal key çağrısında eksik/boş key yok; 421 dinamik çağrı statik envanterle tam doğrulanamaz.

## Güvenlik kontrolü

- Trivy filesystem yüksek/kritik bulgusu: **0**. Bu kaynak taramasıdır; deployment image veya production ortamı kabulü değildir.
- Dependency audit ham sonucu: **2 high, 0 critical**. İkisi `extract-zip@2.0.1` için mevcut, SHA-256 ile doğrulanan yerel patch kapsamında; kurulu paketin traversal/symlink/no-overwrite saldırı regresyonları geçti. Politika son geçerliliği **2026-11-03**. Ham advisory'ler saklandı; “hiç advisory yok” denmedi.
- Staged secret gate geçti. Tüm dizin Gitleaks taraması 14 sonuç verdi: derleme/coverage çıktılarında önceden incelenmiş XML/PEM serializer kodunun kopyaları ve tarihsel raporda aynen alıntılanmış `Bearer synthetic` test girdisi. İnceleme gerçek gömülü credential bulmadı; ham redacted çıktı ve tek tek sınıflandırma `gitleaks-final.json` / `gitleaks-review.json` içinde. Taramayı yeşile çevirmek için allowlist genişletilmedi.
- Pozitif canary, izin verilen kaynak yollarına gerçek üretilmiş private key ve API key koyulduğunda scanner'ın hâlâ reddettiğini doğruladı. Anahtarlar geçici dizinden temizlendi, rapora alınmadı.

## Doğrulanmamış kabul alanları

1. Gerçek Genesys/Avaya/AES/Engage müşteri ortamında teklif → güvenli launch → veri kaynağı → wrap-up → platform write-back uçtan uca zinciri. Hub/sidecar/command/ACK testleri ve simulator fixture'ları geçti; gerçek lisanslı endpoint/hesap bulunmuyor.
2. İki farklı yetkili SSO kullanıcısıyla gerçek Designer ekranları arasında birlikte düzenleme, flush ve reconnect. Backend collaboration/WebSocket testleri geçti; `collaboration-live` browser lane'i için iki auth state ve disposable draft verilmedi.
3. Gerçek Admin audit/SSO müşteri-fixture kabulü ve clean-installation demo lane'i. Yerel ayrı Keycloak OIDC/SAML gerçek login/logout geçti; müşteri Entra/Okta/SAML politikaları veya provisioned mTLS demo topology verilmedi. `test:live` / `test:demo-smoke` başarılıymış gibi işaretlenmedi.
4. Agent'ın gerçek desktop latency lane'i gerekli canlı bağlantı fixture'ı olmadığından çalışmadı. Designer 1.000-node ve runtime 500-node ölçümleri yalnızca bu yerel donanımda doğrulandı.
5. Kullanıcının kapsam dışı bıraktığı production edge, server kurulumu, deployment, kapasite, WORM/SIEM müşteri altyapısı ve immutable image digest kabulü yapılmadı. Production edge browser testi fixture koşusunda bu nedenle atlandı; yerel nginx güvenlik denetimi ayrıca geçti.

Atlanan case'ler sessiz geçiş değildir: Agent Chromium'da 3, Agent WebKit/Firefox'ta toplam 4, Designer Chromium'da 1. Canlı Admin lane'i de fixture test sayısına dahil değildir. Quarantine eklenmedi, testler başarısızlığı gizlemek için skip'e çevrilmedi.

**Karar:** Yerel ürün işlevselliği ve mevcut otomatik kalite kapıları başarılıdır. Üç tarayıcıda tespit edilen iç ürün engelleri kapatılmıştır. Yukarıdaki gerçek ortam kabulleri tamamlanmadan bütün ürünün koşulsuz canlı kabulünü veya sıfır hata garantisini vermiyorum.

## Tekrar çalıştırma ve kanıt

Ana komutlar:

```sh
pnpm exec turbo run test --force --concurrency=1 --continue=dependencies-successful
pnpm exec turbo run lint typecheck build --concurrency=2
pnpm coverage:check
pnpm test:typecheck
pnpm test:lint
pnpm test:policy
pnpm test:audit
pnpm audit:inventory
node --test scripts/*.spec.mjs
pnpm --filter @verbis/designer-web exec playwright test --workers=1
pnpm --filter @verbis/agent-web exec playwright test --workers=1
pnpm --filter @verbis/admin-web exec playwright test --project chromium --workers=1
pnpm --filter @verbis/ui exec playwright test --workers=1
pnpm --filter @verbis/components exec playwright test --workers=1
DOCS_CROSS_BROWSER=1 pnpm --filter @verbis/docs-site e2e
pnpm --filter @verbis/api exec vitest run --config ../../tests/verification/v2.config.mjs
pnpm --filter @verbis/api test:perf
node scripts/dependency-security.mjs --output /tmp/dependency-audit.json
node scripts/secret-scanner-policy.mjs
```

Admin/Agent/Designer çapraz tarayıcı koşuları, aynı preview portunu paylaşmayan geçici config'lerle yürütüldü; kullanılan config'ler ve Java komutları `commands.json` ile birlikte kanıt dizininde saklandı. Başarısız başlangıç/recheck logları da saklandı. Browser JSON sonuçları, raw frame attachment'ları, Java XML özetleri, coverage ve güvenlik çıktıları aynı dizindedir. `source-fingerprint.json` 1.608 kaynak/config/test dosyasının hash'ini içerir; generated build çıktılarını ve tarihsel evidence'ı kapsam dışı bırakır.
