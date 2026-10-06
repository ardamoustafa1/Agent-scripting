# B tablosu — uygulama ve yerel kabul, 2026-10-06

Kullanıcının kapsam düzeltmesi: **“repo işini yapma”**. Commit, push, uzak repo,
branch protection ve uzak CI bağlantısı yapılmadı. K-01/T-11/T-12/T-13/T-02 için
yerel sonuçlar uzak CI kanıtı değildir. Önceki oturum değişiklikleri korundu.

Bu kayıt, eski B envanterindeki kod eksiklerini yeniden inceleyip uygulanan
değişiklikleri ve bu checkout üzerinde doğrulanan sonuçları gösterir. Gerçek SDK,
sandbox, PSP veya müşteri ağı kabulü yerel fixture sonuçlarıyla kapatılmaz.

## Grup 3 ve 6

- **Immutable data source pinleri:** `DataSourceVersion` append-only snapshot deposu,
  tenant RLS, checksum ve immutable trigger ile korunur. Save transaction'ı yeni
  revizyonu kaydeder; runtime, yayın doğrulaması ve package export belge pinindeki
  revizyonu kullanır. Canlı kaynağın silinmesi veya okuma yetkisinin kaldırılması
  hâlâ uygulanır. Kaynak key/tenant değişimi service ve DB seviyesinde reddedilir.
  Aynı pakette aynı key için farklı pinler sessizce birbirini ezemez; ayrı paket
  gerektiren açık hata döner. Production profil/approval verisi pakete taşınmaz.
  Migration yalnız mevcut revizyonu geri doldurabilir; daha önce saklanmamış eski
  içerik yeniden üretilemez ve eksik tarihsel pin fail-closed reddedilir.
- **M-15:** Yjs update başına 2 MiB sınırı, frame overhead sınırı ve oluşan belgenin
  boyut doğrulaması uygulanır; oversized update kalıcı belgeye uygulanmaz. Kalıcı
  conflict kurtarma ve tek oda sahibi sınırları ADR-0044'te geçerliliğini korur.

## Grup 8

| ID | Kodda son davranış | Yerel kabulün sınırı |
|---|---|---|
| M-25 | AXP ayrı token URL/config ve wrap-up sözleşmesi; tokenlar log/audit payload'ına yazılmaz. | Sentetik HTTP sözleşmeleri; canlı AXP kabulü yok. |
| M-26 | Finesse reason sınırı UTF-8 **40 byte**, Flex optimistic update `If-Match` ile. | Mock HTTP regresyonları; gerçek platform kabulü yok. |
| M-27 | OCS `RequestDistributeUserEvent` TS ve Java tarafında; unavailable SDK fail-closed. | Sidecar Testcontainers ve imza derlemesi; Genesys Cloud canlı sandboxın dört opt-in testi çalışmadı. |
| M-28 | AACC subscription/mTLS ve imzalı notification doğrulaması; yanlış imza reddedilir. | Sentetik sertifika/HTTP kabulü; AACC vendor kabulü yok. |
| T-09 | JTAPI/PSDK signature stub source set ve compile-only jar; stub modunda deployable jar/bootJar üretilmez. | Docker/JDK21 derlemesi geçti. Stub gerçek lisanslı SDK uyumluluğu veya telephony çalışması kanıtı değildir. |
| DLQ | Yetki kontrollü stats/replay UI, limit doğrulaması, CSRF, ayrı onay, tenant bound API ve `connector.deadletter.replayed` audit. | API/UI/hub sentetik sözleşmeleri. Hub replay dış yan etkisiyle DB audit tek dağıtık transaction değildir. |

Sekiz vendor için gerçek SDK ve canlı connector kabulü hâlâ erişim/lisans gerektirir.
MATRIX.md fail-closed durumlarını açıkça gösterir. Mevcut CI tanımları yerel dosya
olarak korunur; hiçbir uzak lane çalıştırılmış sayılmaz.

## Grup 9

| ID | Uygulama ve yeniden doğrulama |
|---|---|
| P-18 / D-29 | `/auth/session` authenticated session/anon limitine ek ortak Redis IP bütçesi; trusted proxy sınırı. UI Retry-After numeric/date yorumlar, TR/EN geri sayım ve süre sonunda yeniden deneme gösterir. Auth query focus refetch azaltıldı; 429 oturumu yanlışlıkla kapatmaz. |
| D-01 | Kampanya kapsamıyla create/assignment transaction'ı ve oluşturulan sürümlere erişim regresyonları; TR/EN 403 açıklaması, anlamsız retry kaldırıldı. Tarayıcıda dört locale×viewport kapsam/403 testi yeniden koştu. |
| D-04 | Drop geometrisi önce/sonra insertion ve ancestor fallback; yanlış ebeveyne/sona ekleme regresyonları, klavye reorder. |
| D-08 / D-09 | Inspector alanları component şemasına göre; ham message key/duplicate editor gürültüsü kaldırıldı. JSON/option hataları alan bazında ve validation sayacında, silinen seçeneklerin artık label mesajları temizlenir. |
| D-12 / D-13 | Yeni variable Apply'e kadar geçici taslak, cancel hiçbir kayıt bırakmaz. Yeni sayfa adı ile seçili sayfa rename ayrıdır; flow'a bağlı ekleme ve default ad regresyonları. |
| D-15 | Page node gerçek sayfa adı, ELK aralıkları, boş minimap gizleme. Node/edge silme generated rule'u yalnız başka referans kalmadığında temizler; user/shared rules korunur. Drag/undo/double-click Chromium ile geçti. |
| D-17 | Integration list/picker ve admin identity seçeneklerinde tenant/yetki filtreli server search; ilk 50/100 kaydın client filtresine bağlı kalmaz. Seçilmiş isimler search sırasında korunur. |
| D-19 / D-20 | Preview iframe `sandbox="allow-same-origin"`, CSP script-src none; allow-scripts yok. Parent portal render çalışır, içerikte script/inline handler Chromium'da reddedilir. Cihaz panel genişliğine ölçeklenir, sayfa/action/severity/service alanları TR/EN. |
| D-25 | Rollback hedef/etki onayı + iptal; onay öncesi mutation yok, expected-head optimistic guard. |
| D-26 | Non-empty, başarılı, checksum/version-bound regression raporu **server approve/publish** kapısında zorunlu. Boş/failed/stale rapor kapıyı açmaz; geçerli rerun açar. UI nedenini açıklar. |
| D-27 | Screens create/new immutable version UI, yetkili script sayfasından fragment. Linked page açık salt-okunur uyarısı ve disabled editor; scoped impact +N gizli kampanya sayısı, gizli ID/name sızmaz. Publish event bütün gerçek consumer'ları bildirir; UUIDv7. |
| D-36 | İlk WS sync için deadline/auth failure geri dönüşü; başarısız join REST düzenlemeyi kilitlemez. Dev collab port 4010 ve proxy yapılandırması. Gerçek iki SSO kullanıcısıyla browser edit/reconnect/yorum kabulü henüz koşmadı. |
| P-13 | Session list küçük, yetki kontrollü channel/customer label taşır; customer disclosure audit edilir. Pasif 25 tab için tam `/desktop` dokümanı veya writer lease alınmaz. İlk tab activation hydrate eder; aktive olmuş controller yaşam döngüsü korunur. |
| Lokasyon | Tenant RLS/UUIDv7/audit/outbox/version kontrollü catalog CRUD, server search; admin create/edit/delete ve rol site scope named picker. |

P-13 Chromium fixture ölçümü `agent-25-session-performance.json` içindedir:
25 session, **1 desktop hydration / 1 attach**. Süre yerel mocked API ölçümüdür;
staging 2.000 oturum veya üretim performansı iddiası değildir. Inspector ve yeni DLQ
kartı görselleri incelenerek yalnız ilgili light/dark/HC baselineları güncellendi.
Diğer görsel kontrollerin eşikleri değiştirilmedi.

## Grup 10 ve on öneri

| # | Özellik | Bu dilim / kalan kabul |
|---|---|---|
| 1 | Yayın öncesi script testi | Checksum/version-bound zorunlu non-empty server regression gate, bozuk/başarısız/stale rapor reddi. |
| 2 | Audit sertifikası | Yetkili sequence aralığı/checkpoint/hash/JWK imzalı export; oluşturulan imza yayımlanmış JWKS ile tekrar doğrulanır. `audit.certificate.created` aynı request transaction'ında. Bağımsız Node CLI doğru belgeyi doğrular, değiştirilen belgeyi reddeder. |
| 3 | PCI/kayıt durdurma | Pause ACK olmadan capture yok; vendor AbortSignal'ı yok saysa da timeout; capture hata verse resume denenir, resume ACK hatası başarı sayılmaz. Bu guard standalone utility'dir; gerçek PSP flow entegrasyonu ve vendor recording ACK/recording içeriği kabulü açık. |
| 4 | Bozuk script önizleme | Node/path lint, local schema ve publication validator, eksik kaynak/pin ve invalid node reddi, panel ölçüsüne uyan preview. |
| 5 | Çok oturumlu masaüstü | Yetkili metadata etiketleri, lazy hydration, takeover/old writer komut reddi regresyonları. 25-session browser ölçümü. |
| 6 | Outcome önerileri | Yetkili report cohort filtrelemesi **aggregation öncesi**. Her kohortta min 30 session, veri kaybı sınırı ve anlamlılık; missing start/terminal/count tutarsızlığı öneri vermez. API + TR/EN Admin tablosu. |
| 7 | Private egress | Önceki outbound HTTP/SQL/mTLS/CIDR/DNS pinning korunur; SQL Designer named read-only query/profile/gateway formu eklendi. Müşteri ağında TLS/DNS/restart/yük kabulü açık. |
| 8 | Metin okuma kanıtı | mustRead ack node/page/text-props checksum, **tam scriptChecksum + scriptVersionId**, timestamp ile bağlanır. Metadata kanıtıdır; ses kaydında gerçek okuma/spoken words ispatı değildir. |
| 9 | Collab/yorum/inceleme | Persistence/conflict, review/yorum sözleşmeleri ve bağlantı hata kurtarması. İki ayrı SSO browser kullanıcısı ile live kabul açık. |
| 10 | Tenant onboarding | Manage Tenant + create Campaign/Script/Connector, tenant row lock ve idempotent settings bundle. Draft campaign/script/version + disabled simulator + assignment; otomatik review/publish yok. Audit/outbox request transaction'ında. Gerçek PostgreSQL/Redis/NATS API integration: admin success, designer 403, repeat kopya yaratmaz. |

## Son yerel kapılar

Son sonuçlar ve SHA-256 manifesti:
[summary.json](evidence/b-completion-20261006/summary.json).
Ham loglar `reports/b-completion/` altındadır. Test kapılarının geçmesi yalnız yerel
checkout kabulüdür; uzak CI, licensed SDK ve canlı müşteri kabulü yerine geçmez.

Java sidecar normal testleri: Avaya **28**, Engage **13**, fail/error/skip **0**.
İki sidecar signature-stub derlemesi geçti. API gerçek snapshot/onboarding integration
**24/24**, pin/package **26/26**, runtime/recording/locations **76/76**, policy **54/54**,
bağımsız certificate CLI **2/2** hedefli kanıtları ayrıca saklandı.

Root lint **33/33**, typecheck **32/32**, build **19/19**, test **32/32** geçti.
API **2.067**, Designer **427**, Admin **128**, Agent **156** test; Hub **684 passed +
4 live sandbox skip**. Son lint düzeltmesi sonrası package regresyonu **26/26** ve
D-01 gerçek API versions/draft GET kabulü dahil publication/scope **14/14** geçti.
Merkezi coverage **18 workspace / 0 hata**; format/test:typecheck/test:lint geçti.
Chromium/axe Designer **261**, Admin **50**, Agent **38**, Docs **12**, toplam **361**;
fail/skip/flaky **0** (normal projeler). Java JUnit XML ve Playwright JSON saklandı.
Güvenlik path eşikleri %95 line/%90 branch
ve fuzz denemeleri azaltılmadı. Hub'ın dört opt-in Genesys sandbox testi canlı ortam
olmadığı için skip; normal Chromium suite live collab projesini kapsamaz.

## Açık kalan erişim kabulleri

1. Kullanıcı kapsam dışı bıraktı: commit/push/remote/branch protection/uzak CI.
2. Sekiz vendor gerçek SDK/lisans, AXP/AACC/Finesse/Flex/OCS live kabulü ve Genesys sandbox.
3. Gerçek PSP ve vendor pause/resume ACK; guard'ın gerçek PSP capture akışına entegrasyonu.
4. İki ayrı SSO identity ile live collaboration/reconnect/yorum kabulü.
5. Üretim müşteri ağı private gateway kabulü ve staging 2.000 oturum yükü.

Bu maddeler tamamlandı olarak işaretlenmedi.
