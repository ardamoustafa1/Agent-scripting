# Yayın kapısı — 2026-10-06

Kapsam: AUDIT_REPORT.md M-Z3, M-Z5, M-X1, M-X2.

## Uygulama

- Submit artık mevcut approve/publish/rollback kapısıyla aynı sunucu doğrulamasından geçer. Zamanlanmış yayın da lifecycle.publish üzerinden güncel kapıyı tekrar çalıştırır. Tüm sayfaların ComponentRegistry prop/event/binding/child/plugin sözleşmeleri denetlenir; senaryonun uğramadığı sayfalar da kapsanır. Binding bulunan node'un bilinmeyen veya geçersiz statik prop'ları artık doğrulamayı atlayamaz. Zod hataları node'un JSON Pointer yoluyla problem+json içinde döner.
- En az bir kayıtlı sentetik senaryo zorunludur; bütün senaryolar geçmelidir. Boş küme `passed:false` ve boş results döndürür; lifecycle/import, `/testScenarios` hatasıyla reddeder. Designer sıfır senaryoyu açıkça gösterir ve eski bir API'nin `passed:true, results:[]` yanıtını yayın izni saymaz. Senaryolar mevcut gerçek core-runtime ve yalnız mock portlarıyla, mevcut timeout bütçeleri içinde çalışır.
- Submit/onay/publish/rollback, her dataSources.ref için hedef tenant'taki silinmemiş kaydı, birebir sürüm pinini, geçerli tanımı ve prod profilini kontrol eder. Mevcut veri modeli ayrı immutable/onaylı data-source sürüm tablosu tutmaz: prod profilini normal save değiştiremez, mevcut promotion onayı oluşturur. Bu kapı o modeli kullanır; kaynak satırlarını sabit sırayla FOR SHARE kilitleyerek kontrol/transition sırasında edit/delete/promotion yarışını engeller. Yayından sonraki entegrasyon düzenlemesi mevcut pinleri geçersiz kılabilir; tarihsel veri kaynağı sürüm depolaması bu değişiklikle eklenmedi.
- İmzalı import özgün imza/checksum üzerinden doğrulanır. Scriptler ve bütün ortak ekran fragment'lerinin bileşenleri, ortak ekranlara ait ref/sürüm pinleri de denetlenir. Script senaryoları geçmeden import yapılmaz. Secret/ref eşlemesi ve entegrasyon oluşturma sonrası gerçek hedef kayıtlar tekrar doğrulanır. Import taslak üretir; taşınan entegrasyonun prod profili kaldırılır, hedef ortamda submit/publish öncesi onay gerekir. Dry-run çözümlenmemiş bağımlılıkları yazmadan plan olarak gösterir. Yalnız ortak ekran içeren bir paket, script senaryosu taşıyan çalıştırılabilir belge değildir.
- Oluşturma ekranı, yazarın okuyabildiği ve script oluşturabildiği kampanyaları bütün sayfalardan getirir; seçim zorunludur. Modal katmanının fareyi engellediği Radix portal yerine etiketli native select kullanılır. POST /v1/scripts campaignId ile script + latestPublished assignment'ı aynı tenant transaction'ında, audit/outbox ile oluşturur. Kampanya kapsamlı yazar atamasız oluşturamaz; yetkisiz veya yabancı tenant kampanyasına kayıt yapılamaz. Kapsamsız yönetici/servis istemcilerinde campaignId API uyumluluğu için isteğe bağlıdır.
- Eksik kampanya kapsamı `403 VERBIS_AUTHZ_SCOPE_MISSING` ile açıklanır. Yetki dışındaki dolu kampanya ve rol/SoD reddi aynı güvenlik denetimlerinden geçer. TR/EN oluşturma ve release ekranlarında anlaşılır açıklama, boş kampanya ve yeniden deneme durumları bulunur. OpenAPI ve Designer istemci tipleri güncellendi.

## Kanıt

Önceki kaynakta testler gerçekten başarısız oldu: API boş senaryo/eksik kaynak/submit kapısı için 6 kırmızı test (`api-before.log`), binding ile statik prop atlama için 1 (`core-before.log`), eksik kampanya kodu için 1 (`scope-before.log`), kampanya seçim ekranı için 1 (`designer-before.log`). Ortak ekran boşluğu ayrıca yazılan testle yeniden üretildi: imzalı bozuk fragment import'u başarılı dönüyordu (`fragment-before.log`), düzeltmeden sonra reddedilir.

İlk import negatif fixture'ındaki olmayan i18n key'i, scenario default/checksum uyumsuzlukları ve ilk integration fixture'ındaki var olan rolü tekrar oluşturma hatası ara loglarda korunur; bunlar ürün regresyon kanıtı sayılmaz. Mevcut integration fixture'larına gerçek senaryolar, sentetik mock data-source çıktıları ve onaylı profil fixture'ı eklendi. PII scenario yasağı korunur. Eski browser fixture'larının boş başarılı raporları geçerli senaryo sonucuyla değiştirildi; yeni boş-rapor negatif testi kapıyı ayrıca doğrular. Assertion/timeout/axe/screenshot toleransı gevşetilmedi.

| Kontrol | Sonuç |
| --- | --- |
| API scripts + AuthzService unit | 219/219 |
| Gerçek izole API/Postgres/Redis/NATS lifecycle/routing + yayın kapısı | 30/30; submit/publish/import retleri, değişmeyen state/head, geçerli prod pin, scoped atomic create, yabancı tenant, imzalı import ve SoD dahil |
| Designer tam unit | 367/367; native kampanya alanı son değişikliğinden sonra ilgili 5/5 tekrar |
| Designer normal tam Chromium | 251/251; dört yeni TR/EN 390/1440 scope/403/axe testi, mevcut fareyle oluşturma ve üç tema lifecycle a11y dahil |
| Core runtime tam unit | 125/125; son registry tip değişikliğinden sonra 4/4 tekrar |
| Components tam unit | 295/295 |
| Agent tam unit | 139/139; ilk paralel koşuda supervisor butonu zamanlaması 1 kez başarısız, worker=1 tam tekrar geçti; tolerans değişmedi |
| Shared types / i18n | 46/46 ve 8/8 |
| OpenAPI drift | 7/7 |

API/Designer typecheck ve Designer production build geçti; mevcut ELK chunk boyutu uyarısı sürer. Designer/Core/shared/i18n lint ve değiştirilen API dosyalarının lint'i geçti. Tam API lint bu tur dokunulmayan integration/KMS dosyalarında aynı 12 hatayı gösterir: vault-provider.spec.ts, vault-transit-client.ts, integration-engine.service.ts, integrations.module.ts.

Kanıtlar ve SHA manifest: `docs/verification/evidence/publication-gate-20261006/`. API integration yalnız Testcontainers servisleri ve sentetik tenant verileri kullanır; browser UI testleri kontrollü API fixture'ları kullanır. Kullanıcının mevcut dev servisleri ve tenant verileri değiştirilmedi.
