# Tüm sayfalar: gerçek tarayıcı ve regresyon denetimi — 2026-10-05

Studio’nun 10 ana sayfası, mevcut tenant yöneticisinin erişebildiği 12 Admin sayfası ve Agent bekleme/izleme/tercih ekranları gerçek oturumlu Chrome üzerinden açıldı. Formlar, arama, sekmeler, boş durumlar ve güvenli sentetik iş akışları denendi. Beş bulgu düzeltildi. Bu kayıt bütün olası veri/yetki kombinasyonlarının veya enterprise üretim kabulünün kanıtı değildir.

## Yöntem ve kanıt

Gerçek kullanıcı arayüzü CUA ile gezildi; ayrıca Chromium Playwright senaryoları ve birim testleri çalıştırıldı. Gerçek sunucu işlemleriyle fixture tabanlı otomasyon ayrı değerlendirilir. Tarayıcı AX kayıtları, ekran görüntüleri ve kapsam notları `artifacts/all-pages-function-audit/` içindedir; `coverage.json` kaydedilmiş ekranların açıklamalarını içerir. Loglar ve SHA-256 manifesti `docs/verification/evidence/all-pages-function-20261005/` içindedir. Önceki derin Scriptler denetimi: [rapor](SCRIPTS_FUNCTIONAL_AUDIT_2026-10-05.md).

## Studio gerçek tarayıcı kapsamı

| Sayfa | Denenen işlemler ve görünür sonuç | Sınır |
|---|---|---|
| Analitik | 7/30 gün, kanal/kampanya filtresi, temizleme; ters tarih aralığında dışa aktarma pasif. CSV 265 B ve XLSX 13,6 KB tamamlandı. Alıcısı boş zamanlama formu zorunlu alan kontrolüne takıldı. | Gerçek e-posta/zamanlama oluşturulmadı. |
| Kampanyalar | Arama/boş sonuç/temizleme; boş adla oluşturma pasif; sentetik taslak ve not gerektiren başarı sonucu kaydedildi. Üç ayrıntı sekmesi açıldı. | Atama/aktivasyon yapılmadı. Küçük harfli subCode genel doğrulama hatası veriyor; büyük harfle geçerli kayıt başarılı. Alan bazlı açıklama iyileştirilebilir. |
| Scriptler | Liste araması/temizleme; önceki kapsamlı editör denetimine ek olarak şablondan türetilen taslak önizlemesi ve sunucu regresyonu. | Gerçek onay/yayın/package transferi ve bütün roller denenmedi. |
| Ekranlar | Liste/kart görünümü, arama ve temizleme; boş kütüphane düzgün gösterildi. | Tenantta kayıt yok; dolu kayıt düzenleme bu oturumda doğrulanmadı. |
| Entegrasyonlar | Oluşturma, cURL içe aktarma, bozuk header JSON reddi, örnekten şema çıkarma, eşleme, 8 sekme, timeout/retry, PII maskeleme, sentetik mock kaydı ve test. Kaydedilmiş eşleme korunuyor; bozuk konsol JSON artık önceki girdiyi çalıştırmıyor. | HTTPS example.invalid sentetik tanımı; gerçek dış servis, kimlik bilgisi, üretime taşıma yok. Mock hata/gecikme/boş yanıt varyantları bu gerçek oturumda yürütülmedi. |
| Değişkenler | QA script seçimi, iki değişken, qaTracking filtresi, tip sıralama, temizleme. | Bütün tip/property kombinasyonları değil. |
| AI asistanı | Tenantta kapalı ekran ve açıklaması görüldü. | Canlı AI kullanıcı talebi doğrultusunda kapsam dışında. |
| Şablonlar | NPS arama, temizleme; kaynak QA scriptinden tenant şablonu oluşturma; bağımsız script üretme. Altı yerleşik şablonun kullanım diyaloğu doğru adla açıldı ve kapatıldı. | Yerleşik altı şablondan yeni kayıt üretilmedi. |
| Yayınlar | QA script/v1 seçimi, zorunlu sürüm/not boşken inceleme pasif; dört kayıtlı senaryo gerçek sunucuda 4/4 geçti. | Gerçek yayın/onay verilmedi. |
| Ayarlar / ortak kabuk | Organizasyon/ortam bağlamı, sidebar daraltma/genişletme, üç adımlı rehber, Cmd+K entegrasyon araması, bildirimden yayınlara geçiş, TR→EN→TR. | Organizasyon/ortam/yetki/oturum politikası değiştirilmedi. Tema menüsü açıldı; temaların detayları otomasyon kapsamında. |

## Admin ve Agent gerçek tarayıcı kapsamı

| Alan | Denenen / görülen | Sınır |
|---|---|---|
| Admin Analitik | Sayfa açıldı ve mevcut tenant bağlamı incelendi. | Üretim ölçüm doğruluğu/yük kabulü değil. |
| Kimlik / SSO | Aktif geliştirme Keycloak sağlayıcısı, detay ve claim kuralları. | Yeni IdP/token/credential testi yapılmadı. |
| Kullanıcılar / roller | Mevcut kullanıcı, 15 rol, tenant_admin claim ve oturum ayrıntısı. | Yetki verme/oturum iptali yapılmadı. |
| Connector’lar | Boş liste, oluşturma formu ve eşleme alanları. | Connector provision edilmedi. |
| Secret kasası | Mevcut secret metadata ekranı. | Secret değeri okunmadı/değiştirilmedi. |
| AI yönetimi | Kapalı politika ekranı. | Etkinleştirilmedi. |
| Audit | script.template.instantiated filtresi gerçek QA işlemini buldu. Bütünlük: valid=true, checked=168, signaturesVerified=true, breaks=[], truncated=false, genesis anchor. JSON 829 B indirildi. | CSV butonuna basıldı fakat tamamlanması ayrıca doğrulanmadı; SIEM ayarı değişmedi. |
| Güvenlik | SoD açık, oturum ve launch JWKS politikası incelendi. | Güvenlik ayarlarına yazılmadı. |
| Veri | Saklama/PII/DSAR ekranı; doğrulaması eksik DSAR kaydı pasif. | Silme veya retention değişikliği yok. |
| Marka | Form ve önizleme kontrolü görüldü. | Marka ayarı kaydedilmedi. |
| Simülatör | Etkin simulator connector bulunmadığı açıkça gösterildi. | Gerçek simülasyon yapılandırma nedeniyle çalıştırılamadı. |
| Sağlık | database/redis/nats up; outbox pending=0, dead=0. | HA/kapasite/restore kanıtı değil. |
| Agent bekleme | Bağlantı kurulu, son oturumlar boş. | Aktif yayımlanmış runtime oturumu yok. |
| Agent izleme | Boş liste artık açıklama ve pasif oturum seçicisi gösteriyor; düzeltme gerçek ekranda doğrulandı. | Aktif oturum izleme bu tenantta yürütülemedi. |
| Agent tercihler | Yazı boyutu Medium→Large→Medium ve eski değere dönüş. | Diğer tüm kişisel tercihler denenmedi. |

Superadmin tenant yönetimi mevcut rolün menüsünde bulunmuyor; fixture tabanlı test olması gerçek rol kabulünün yerine geçmez. Mevcut oturumlarla üç uygulama erişilebilir. IAB yeni giriş denemesi localhost:8080 realm 404’e ulaştı; yeni oturum SSO akışı bu denetimde doğrulanmış değildir.

## Düzeltilen beş bulgu

1. Entegrasyonun kaydedilmiş eşleme alanları sekmeye dönüşte görünmüyordu; yeni alan eski eşlemeyi ezebiliyordu. Görsel alanlar kaydedilen ifade üzerinden çözülür ve birleştirilir. Karmaşık manuel ifade çözülemiyorsa koruyucu açıklama gösterilir, görsel işlem ifadeyi ezmez. İfade çalıştırılarak ayrıştırılmaz.
2. Entegrasyon konsolunda bozuk JSON, önceki geçerli girdiyi sessizce test ediyordu. Artık API önizleme çağrısı durdurulur; JSON düzeltildiğinde mock tekrar başarılı olur. Önce/sonra gerçek tarayıcı ve başarısızdan başarılıya regresyon kanıtı vardır.
3. Admin rol açıklaması etiketi yanlışlıkla sayfa giriş metnini gösteriyordu. TR/EN kısa Açıklama/Description etiketi düzeltildi.
4. Admin SIEM Biçim/Format etiketi eksik çeviri anahtarını gösteriyordu. Her iki dilde eklendi.
5. Agent canlı izleme boş listesi açıklamasızdı. Yerelleştirilmiş boş durum ve pasif seçim kontrolü eklendi; dolu liste seçicisinin yüklenmesini bekleyen mevcut test düzeltildi.

İlk başarısız regresyonlar ve ara koşular saklanır. Timeout, screenshot toleransı, axe, yetki, onay veya yayın kapıları gevşetilmedi. Bu tur yaygın tasarım sistemi yeniden yazımı içermez; yerleşim/tema/axe kontrolleri mevcut tam tarayıcı suite’inde yeniden geçti.

## Son doğrulama

| Suite | Son sonuç |
|---|---|
| Studio unit | 351/351, 49 dosya; serial `vitest run --maxWorkers=2` |
| Admin unit | 101/101, 13 dosya |
| Agent unit | 126/126, 16 dosya |
| i18n unit | 7/7 |
| Studio Chromium | 224/224 |
| Admin Chromium | 22/22 |
| Agent Chromium | 28 başarılı, 2 atlandı |

Toplam 585 birim testi ve 274 başarılı Chromium senaryosu. İki atlama: aktif yayımlanmış oturum/storage state gerektiren Agent gerçek performans testi; Vite yerine üretim nginx edge gerektiren CSP/nonces/Trusted Types güvenlik testi. Bu atlamalar başarılı sayılmaz.

Üç web uygulamasında lint ve typecheck geçti; üretim build’leri geçti. Son Studio production build logu saklandı; mevcut >500 kB ELK chunk uyarısı sürüyor. `git diff --check` temiz. İlk yoğun eşzamanlı Studio koşusu 349 başarılı/2 timeout; test sınırları değiştirilmeden yalnız çalışan son koşu 351/351. İlk failing mapping/JSON regresyonları ve ara loglar da saklandı.

Otomatik tarayıcı senaryoları çoğunlukla API fixture’ları kullanır; gerçek QA sunucu işlemleri yukarıdaki tabloda ayrı belirtilmiştir. Aynı testin tekrarları toplam sayıya eklenmez. Chromium sonucu Firefox/Safari kabulü değildir.

## Sentetik test verisi ve çalışma alanı

- Kampanya: QA - Tüm sayfalar kampanyası, `01a10d61-bf5c-7026-8b4c-614787ec4690`; taslak, QA_RESOLVED, QA_DELIVERED/QA_RETRY, not zorunlu. Canlı atama yok.
- Entegrasyon: qa-all-pages-integration, `01a10d6a-0830-754b-9d0a-507e2ca948b8`; mock, example.invalid, credentials yok, PII maskeleme açık. Son kayıt result←parcelId; geçici ek state alanı kaydedilmeden eski eşlemeye dönüldü.
- Tenant şablonu: QA - Tüm sayfalar şablonu. Kaynak önceki QA - Scriptler işlev testi v1 (`01a10d32-1808-730e-a1be-51ee68f6fa01`).
- Üretilen bağımsız taslak: QA - Şablondan türetilen script, `01a10d6b-5b7c-74f0-8542-7f8549ae4c48`, v1; dört senaryo 4/4.

Kullanıcı scriptleri arda/Müşteri karşılama ve canlı yayınlar değiştirilmedi. QA taslakları geri incelenebilmesi için tutuldu; silinmedi. Admin/Agent geçici sekmeleri kapatıldı. Studio sekmesi Templates’te açık bırakıldı. Tarayıcı kontrolünde eski AX indeksi yanlış sekmeyi kapattığı için Studio yeniden açıldı; kaydedilmemiş kullanıcı işi kaybolmadı. Kullanıcının 5173/5174/5175 geliştirme servisleri ve API korunur; kendi 5473/5474/5475 preview süreçleri sonlandırılır.

## Açık kabul sınırları

Canlı vendor/AI kullanıcı talebiyle kapsam dışındadır. Aktif Agent oturumu, simulator connector, gerçek yeni SSO girişi, production edge güvenlik başlıkları, gerçek yayın/onay ve bütün rol matrisi tamamlanmış kabul değildir. Kurumsal üretim için staging yük/HA/restore/upgrade/rollback ve bağımsız güvenlik kapıları önceki raporlardaki gibi açıktır. Bu denetimden Awaken üstünlüğü, Apple ölçeği veya sıfır hata garantisi çıkarılamaz.
