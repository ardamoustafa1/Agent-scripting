# Verbis ürün denetimi — ikinci işlevsellik kontrolü, 4 Ekim 2026

## Karar

**Bu denetimde bulunan sekiz ürün sorunu düzeltildi. Son yerel test, build, lint, typecheck ve coverage kapıları geçti.** Sunucu hazırlığı, prod kurulumu, deployment ve image/cluster yayınlama kapsam dışıdır. Mevcut kullanıcı veritabanı sıfırlanmadı; commit/deploy yapılmadı.

Bu sonuç bütün ürün için koşulsuz canlı kabul değildir. Gerçek müşteri platformuna yazma, iki yetkili kullanıcıyla canlı Designer zinciri, müşteri SSO/mTLS kabulü ve gerçek Agent latency akışı hâlâ doğrulanmamıştır. Bunlar sunucu kurulumu dışındaki işlevsel kabul sınırlarıdır. Aşağıdaki test sayıları bunların geçtiği anlamına gelmez. Mevcut otomatik testler bütün olası veri, rol, tarayıcı ve ağ durumlarını kapsamaz.

Önceki raporlar devralınıp başarılı sayılmadı. Güncel kaynaklardan monorepo testleri önbelleksiz yeniden çalıştırıldı; ek hata senaryoları önce başarısız regresyonlarla gösterildi, düzeltildikten sonra tekrar çalıştırıldı. Son değişiklikler için tüm Admin ve Designer unit/coverage süitleri ayrıca yenilendi. Kaynak: [kanıt dizini](evidence/product-recheck-20261004/), [önceki ürün denetimi](PRODUCT_AUDIT_2026-10-04.md).

## Bulunan ürün sorunları

| ID / öncelik | Kullanıcıya etkisi | Düzeltme ve doğrulama |
| --- | --- | --- |
| R-01 / P1 | Designer girişinde e-posta değişmesine rağmen önceki kurumun SSO bağlantısı kalıyordu; geç gelen keşif yanıtı eski bağlantıyı tekrar gösterebiliyordu. | Keşif gönderilen e-postayı alıyor; girdi değişiminde mutation observer sıfırlanıyor. Tamamlanmış ve bekleyen yanıt senaryoları unit, Chromium, Safari/WebKit ve Firefox'ta geçti. |
| R-02 / P1 | Admin girişinde aynı eski SSO sonucu sorunu vardı; onSuccess eski yanıtı doğrudan ekrana taşıyordu. | Ayrı eski discovery state kaldırıldı; mevcut mutation sonucu gösteriliyor, e-posta değişiminde reset ediliyor. Üç tarayıcıda eski/geç yanıt ve yeniden keşif doğrulandı. |
| R-03 / P1 | Admin'de tehlikeli işlem için açık onay, işlem disabled durumuna geçtikten sonra yine çalışabiliyordu. | Onay düğmesi disabled bilgisini alıyor; invoke disabled/busy kontrolü yapıyor. Önce başarısız olan regresyon geçti. Backend yetki kontrolünün aşılması iddia edilmiyor. |
| R-04 / P1 | Admin session endpoint'inin 403/503 cevabı veya bozuk 200 cevabı oturum yok sanılıp giriş formuna dönüştürülüyordu; hata ve retry yolu kayboluyordu. | Yalnız 401 signed-out sonucudur. Diğer hatalar güvenli hata ekranı ve yeniden deneme sunar. HTTP 403/503, bozuk cevap ve 503 → retry → 401 akışları test edildi; üç tarayıcı geçti. |
| R-05 / P2 | Marka ekranının Önizleme düğmesi hiçbir işlem yapmıyordu. | Kaydedilmemiş marka adı, agent başlığı ve bekleme metni bir Dialog'da gösteriliyor. Aç/kapat, Escape, formun korunması, yazma isteği gönderilmemesi ve axe doğrulandı. Safari'de odağın tetikleyiciye dönmesi için design-system Dialog trigger kullanıldı. |
| R-06 / P1 | SIEM hedefi A için açılan silme onayı, hedef B seçildiğinde açık kalıp B'yi silebiliyordu. | Onay bileşenleri kaynak kimliğine bağlandı. SIEM silmede ve gizlilik işlemede sürüm değişimi de onayı yeniler. SCIM token iptali, break-glass devre dışı bırakma ve tek oturum sonlandırma da kayda bağlandı. SIEM hedef değiştirme regression'ı unit ve üç tarayıcıda geçti; diğer sayfaların mevcut davranış süitleri geçti. |
| R-07 / P1 | Designer çıkış sırasında BFF'nin OIDC/SAML sağlayıcı çıkış URL'sini yok sayıp ana sayfaya gidiyordu; sağlayıcı SSO oturumu açık kalabiliyordu. | BFF'nin döndürdüğü HTTP(S) çıkış adresine yönlendirme tamamlanıyor. javascript/data URL'leri ve kullanıcı adı/parola içeren URL'ler reddediliyor. Unit ve üç tarayıcıda üst pencere yönlendirmesi geçti. Bu fixture gerçek sağlayıcı oturum iptalini kanıtlamaz; gerçek sağlayıcı logout backend denetiminde ayrı kontrol edildi. |
| R-08 / P2 | Designer avatar menüsü düğmesinin açık erişilebilir adı yoktu; User menu hedefiyle bulunamıyordu. | TR/EN mevcut userMenu anahtarı aria-label olarak eklendi. Unit named-role kontrolü ve üç tarayıcı menü → Sign out akışı geçti. |

Her düzeltme için başarısız başlangıç regresyonları kanıt dizininde korunmuştur. Testleri geçirtmek için güvenlik kısıtları, görsel baseline'lar, coverage eşikleri veya performans sınırları gevşetilmedi; quarantine veya yeni skip eklenmedi.

## İncelenen akışlar ve yöntem

Üç ana uygulamada 266 etkileşimli JSX tanımı (button, Button, IconButton, Action, SaveForm, link ve form kontrolleri) envantere alındı. Bu sayı dinamik olarak üretilen buton sayısı veya 266 bağımsız başarılı test anlamına gelmez. Handler'sız görünen üç Designer tetikleyicisi DropdownMenu/Popover tarafından bağlanıyor; gerçek işlevsiz marka butonu R-05 ile kapatıldı. Envanter `interaction-inventory.json` içindedir.

| Alan | Kontrol edilen davranışlar | Kanıtın sınırı |
| --- | --- | --- |
| Admin | Giriş/çıkış, tenant/marka/güvenlik ayarları, kullanıcı/rol/scope, IdP ve SCIM, secret rotasyonu, SIEM hedefleri, audit filtre/diff/chain, gizlilik istekleri, simulator, AI ve analytics | Form ve HTTP sözleşmesi testleri; üç tarayıcıda navigasyon, hata, onay, klavye ve axe. Her formun her geçersiz veri kombinasyonu tarayıcıda tek tek gezilmedi. |
| Designer | Yeni script ve taslak, palet/layer drag, reorder/undo/redo, flow/auto-layout, değişken ve kural referansları, ortak ekran pin'leri, integration/cURL, preview/debugger/state restore, regression/approval/publication/assignment, paket/template/comment, AI insan onayı | Unit ve üç tarayıcı fixture akışları. Gerçek iki SSO kullanıcısıyla ortak düzenleme browser kabulü ayrı açık. |
| Agent | Güvenli launch, query spoofing/replay/tamper/expired, SSO erişim sınırı, eşzamanlı etkileşimler, reconnect/offline/autosave/vault, runtime form/geçiş, wrap-up/retry/logout, tema/klavye/axe | Üç tarayıcı fixture testleri; gerçek DB/hub kabulü ayrı. Gerçek vendor write-back ve canlı latency lane'i çalışmadı. |
| Ortak UI/component/runtime | Form kontrolleri, validation, dialog/menu/focus, table/tree, tarih/saat, medya/PSP sınırı, TR/EN/RTL, light/dark/high-contrast, safe expression, script schema, actions ve renderer | UI 167 ve component 208 Chromium testi; expression/schema fuzz/domain süitleri. Manuel VoiceOver/NVDA kabulü yapılmadı. |
| Backend / connector | Identity/OIDC/SAML, SCIM Bulk, RLS/tenant izolasyonu, CASL, launch/CSRF/replay, script lifecycle/regression, integration/SSRF/transport, audit/outbox/SIEM, analytics/AI, simulator/adapter contract, NATS/WS | Gerçek Testcontainers DB/Redis/NATS entegrasyonları; ek 275 gerçek denetim; lisanslı vendor uçları için gerçek platform kabulü yok. |
| Docs / Java sidecar | Dokümantasyon arama/dil/tema ve navigasyon; Avaya ve Engage replay/protocol/NATS bridge | Docs üç tarayıcı; Gradle/JDK21 ve Testcontainers. Opsiyonel lisanslı SDK kaynakları bu koşuda etkin değildi. |

## Son test sonuçları

Tekrarlar benzersiz test toplamına eklenmedi. Satırlar bağımsız katmanlardır; mock browser sonuçları gerçek backend sonuçlarına karıştırılmadı.

| Kontrol | Sonuç | Log |
| --- | --- | --- |
| Önbelleksiz tüm monorepo | 32/32 görev; 4.948 Vitest + 4 docs Node testi | `tests-final.log` |
| Düzeltmeler sonrası tüm monorepo | 32/32 görev; 4.951 Vitest + 4 docs Node testi; 30 görev aynı kaynak hash'iyle cache'ten | `tests-complete.log` |
| En son Designer unit/coverage | 305/305; ek 3 unsafe logout regresyonu dahil | `designer-unit-final.log` |
| Güncel süit envanteri | 4.954 Vitest; yukarıdaki monorepo sonucunda Designer 302 yerine son 305 alınır | Tekrarlar sayılmadı |
| Lint/typecheck/build | 58/58; son kaynak lint/typecheck ayrıca 52/52 | `quality-complete.log`, `static-final.log` |
| Coverage | 18 runtime workspace ve kritik dizin kapıları geçti | `coverage-accepted.log`, `coverage-summary.json` |
| Script testleri / root ESLint / test typecheck ve lint | Başarılı | `tooling.log`, `root-lint.log`, `test-typecheck-final.log`, `test-lint.log` |
| Tüm repo format / diff whitespace | Başarılı | `format-accepted.log`, `diff-check-final.log` |
| Gerçek backend/IdP/network denetimi | 275/275, 5 dosya | `backend-verification.log` |
| Admin Chromium / WebKit+Firefox | 18/18; 32/32 | `admin-browser-complete.log`, `admin-cross-final.log` |
| Agent Chromium / WebKit+Firefox | 24 geçti + 2 atlandı; 44 geçti + 4 atlandı | `agent-browser.log`, `agent-cross.log` |
| Designer Chromium | 53/53, güncel kaynak | `designer-browser-final.log` |
| Designer WebKit+Firefox | Tam koşu 100/100; son auth/release değişiklikleri ayrıca 10/10 | `designer-cross.log`, `designer-auth-cross-verified.log` |
| UI / components Chromium | 167/167; 208/208 | `ui-browser.log`, `components-browser.log` |
| Runtime benchmark / axe | 2/2 | `runtime-browser.log` |
| Docs Chromium/WebKit/Firefox | 12/12 | `docs-browser.log` |
| Java Avaya / Engage | 10/10; 7/7; bütün test görevleri yeniden çalıştırıldı | `avaya-java.log`, `engage-java.log`, `java-results.json` |
| Dependency security policy | Ham 2 high / 0 critical; iki advisory exact yerel patch ve attack regresyonlarıyla karşılanıyor | `dependency-policy.log`; istisna 2026-11-03'e kadar |
| Secret scanner canary | Başarılı; gerçek private/API key canary'leri hâlâ reddediliyor | `secret-policy.log` |

Son coverage: Admin satır %94,61 / branch %88,17; Agent %93,52 / %84,91; Designer %91,47 / %80,22; API %92,89 / %85,57; connector-hub %86,40 / %75,14. Bu değerler açıkça test edilmemiş dallar olduğunu gösterir. Coverage dosyaları kanıt dizininde saklandı.

## Başlangıç başarısızlıkları ve test koşusu düzeltmeleri

- Yeni regresyonlar düzeltmeden önce başarısız oldu: SSO sonuçları, disabled onay, session hata ayrımı, işlevsiz preview, hedef değiştirme ve harici IdP logout. Başlangıç logları `*-before.log` olarak tutuldu.
- İlk genel test koşusu yeni Designer regresyonlarının henüz düzeltme gelmemiş halini yükledi. İlk quality koşularında yeni testlerin ESLint hataları ve yeni Dialog'un zorunlu description prop'u düzeltildi. Başarısız koşular son başarılı koşu yerine kullanılmadı.
- İlk Designer browser koşusunda eski/yeniden üretilen dist dosyalarıyla çakışan testler görüldü. Son kabul koşuları tamamlanmış, sabit derleme üzerinden yürütüldü. Yeniden build sırasında browser kabulü güvenilir sayılmadı.
- Theme seçiminin hemen ardından axe taraması açılır menü modal odağı henüz kapanmadan başlayabiliyordu; main landmark geçici olarak erişilebilirlik ağacında yoktu. Release testi artık menünün kapanmasını ve main'in yeniden görünmesini bekler. Axe kuralları kaldırılmadı; üç temada ve üç tarayıcıda son sonuç geçti.
- Yeni preview'un Safari odağı başlangıçta geri dönmüyordu. Assertion değiştirilmedi; gerçek Dialog trigger kullanılarak ürün düzeltildi. Son 32 çapraz tarayıcı Admin testi başarılıdır.

## Açık kabul sınırları

1. Müşteri Genesys/Avaya/diğer platformlarında gerçek event → launch → data-source → wrap-up → vendor write-back zinciri. Yerel adapter/replay/contract/ACK testleri bu kabulün yerine geçmez; lisanslı SDK/endpoint ve yetkili test hesabı yok.
2. İki ayrı yetkili SSO kullanıcısı ve disposable draft ile canlı Designer co-edit/flush/reconnect. Gerçek backend collaboration testleri geçti; live browser fixture sağlanmadı.
3. Müşteri Entra/Okta/SAML/SCIM politikaları, gerçek mTLS demo topology ve clean-install smoke. Yerel gerçek Keycloak giriş/logout kabulü farklı bir katmandır.
4. Gerçek Agent desktop latency. Browser performans testi fixture yokluğunda atlanır; prod security edge testi de kullanıcının kapsam dışı bıraktığı ortamı gerektirir. Agent'ta üç tarayıcı toplam 6 atlama bu iki case'in tekrarlarıdır; geçti sayılmadı. `*-live` projeleri çalıştırılmadı.
5. Belgelerdeki ürün genişletme sınırları: debugger gerçek tarihsel I/O/timer devamlarını birebir replay etmiyor; SOAP remote WSDL/1.2 uyumluluğu sınırlı; vendor kanal yetenekleri evrensel değil; AI model/NER doğruluğu ve external veri yerleşimi yerel fixture'la sertifikalandırılamaz. Bunlar bu frontend onarımının tamamladığı özellikler değildir. Ayrıntılar `docs/ROADMAP.md` ve connector matrix'te.

**Yerel işlevsellik kapıları başarılı; koşulsuz bütün-ürün canlı onayı açık.** Gerçek platform hesabı/fixture ve kabul ortamı olmadan bu alanlara başarı yazılmadı. Prod server hazırlığı yapılmadı.

## Kanıt ve yeniden çalıştırma

Kanıt dizininde başlangıç ve son loglar, source/test SHA-256 fingerprint'i, interaction envanteri, coverage/Java özetleri, komut manifest'i ve log SHA-256'ları bulunur. Test trace'leri geçici `/tmp/verbis-product-recheck-20261004/` dizininde; müşteri credential'ı veya gerçek kullanıcı verisi rapora alınmadı. Önceden var olan staged/unstaged dosyalar korundu.

Ana komutlar: `pnpm exec turbo run test --force --concurrency=1 --continue=dependencies-successful`; `pnpm exec turbo run lint typecheck build --concurrency=2`; `pnpm coverage:check`; üç app için `playwright test --project chromium --workers=1`; ortak UI/components/runtime için Playwright; `DOCS_CROSS_BROWSER=1 pnpm --filter @verbis/docs-site e2e`; API'de `vitest run --config ../../tests/verification/v2.config.mjs`; `node --test scripts/*.spec.mjs`. Çapraz tarayıcı ve Java komutları manifest'tedir. Browser kabulünden önce build'in tamamlanması gerekir.
