# Kampanya işlemleri, gizli anahtarlar ve kullanıcı rolleri — 2026-10-05

## Kabul kapsamı

Kullanıcının tam proje denetimi talebine devam edildi. Sunucu/prod kurulum ve deployment kapsam dışı kaldı; mevcut kullanıcı verisi ve root `.env` kullanılmadı. Yerel gerçek API, PostgreSQL, Redis, NATS, hub ve üç tarayıcı ile kanıt üretildi. Bu rapor önceki [genel ürün](PRODUCT_AUDIT_2026-10-04.md), [yeniden kontrol](PRODUCT_RECHECK_2026-10-04.md), [gerçek tarayıcı](PRODUCT_REAL_BROWSER_2026-10-04.md) ve [Agent çağrı](PRODUCT_AGENT_ACCEPTANCE_2026-10-05.md) raporlarına ek kabul kaydıdır.

## Düzeltilen bulgular

| Bulgu | Neden ve çözüm | Regresyon |
| --- | --- | --- |
| P1: Yeni kampanya UI'dan etkinleştirilemiyor, sonuç seti tanımlanamıyordu | Create draft üretiyor, detail ekranında yalnızca script/mapping görünüyordu. Yetkili kullanıcıya kampanya ayar formu eklendi; durum, isim, açıklama, kanallar, diller, kuyruklar, sonuç kategori/not/alan/alt kodları gerçek PATCH'e bağlandı. Mevcut API audit ve yetki mekanizması kullanılır. | Önce settings tab bulunamadı; sonra gerçek kampanya yöneticisi, DB, yeniden yükleme ve dört durum geçişiyle doğrulandı. |
| P2: Secret alt bileşenleri create/update iznini bağımsız kontrol etmiyordu | Create/Save artık ayrı izinlerle kapatılır. API izin kontrolü zaten vardı; eski ana menü `manage:Secret` gerektirdiğinden bu bulgu bir API yetki atlatması olarak sunulmaz. | Metadata-only reader bileşen testi önce başarısız, sonra 17/17 süit başarılı. |
| P2: Script okuyucusuna kullanamayacağı AI menüsü gösteriliyordu | Menü `read:Script`, route `create:Script` istiyordu. Menü ve komut paleti route ile aynı izni kullanır. | Önce 1 failed/25 passed; sonra 26/26. Gerçek 10 rolün menü matrisiyle de kontrol edildi. |
| Yeni formda kaydetme bildirimi sürüm değişince kayboluyordu | Formun key'i version yerine campaign id oldu. Query yenilenince form/bildirim korunur, farklı kampanyaya geçince yeniden kurulur. | Gerçek yeni sürüm cevabıyla önce başarısız regresyon, sonra 6/6 kampanya testi. |

Form istemcide ve API'de doğrulanır; CSRF ve If-Match korunur. Virgülle ayrılan alanlar yazarken sondaki virgülü kaybetmez; kayıt sırasında trim/benzersizleştirme uygulanır. Hatalı dil, yinelenen sonuç kodu, sonuç kaldırma, required fields/subcodes ve zorunlu not sınandı. Sürüm çakışmasında otomatik overwrite yapılmaz: 412, görünür hata, korunan form ve değişmemiş DB kaydı gerçek testte kontrol edilir. Zaman penceresi ve çalışma saatleri için yeni bir editör eklenmedi; mevcut API desteği ile görüntüleme davranışı korunur.

## Çeviri taramasında kapanan ek açık

`test:audit` AI status hata ekranındaki `common.retry` anahtarının katalogda bulunmadığını gösterdi. Eski test aynı i18n lookup'ıyla beklenen adı ürettiğinden ham anahtarı fark etmiyordu. TR `Yeniden dene`, EN `Retry` eklendi; test artık iki dilde sabit gerçek buton adını arayıp retry ve toparlanmayı doğrular (7/7). Literal çeviri/audit süiti 2/2, policy süiti 5/5 geçti. Envanter 1.531 TR / 1.531 EN anahtar, 736 literal kullanım, 134 mutation-shaped route içerir. Discovery POST okuma işlemidir ve açık read-only istisna olarak korunur; envanter taraması yürütülmüş endpoint testlerinin yerine sayılmaz.

## Ortak düzenleme çıkışında ek bulgular

Tam Firefox tekrarında çıkan yarış ayrıca incelendi. İki ek hata, başarılı önceki koşulara rağmen regresyonlarla ortaya çıkarıldı:

- Flush başarılı olduktan sonra editörün dirty/saved durumu yenilemeden önce kesin olarak güncellenmiyordu. Çıkış artık son kayıt sürümünü ve belgesini API'den alır, yerel belgeyle anahtar sırasından bağımsız karşılaştırır, yalnızca eşleşiyorsa kayıt bildirimini React'e senkron olarak işler ve yeniler. Çıkış süresince yeni yerel yazılar durdurulur. Belgeler farklıysa yerel değişiklik silinmez/temiz sayılmaz; hata panel açık olmasa da görünür. Çıkış butonu busy durumda yeni gönderimi engeller. Başarısız önceki ACK regresyonundan sonra 9/9 CollaborationPanel testi geçti.
- Gerçek API kapatılırken Hocuspocus'ta bağlantısı 0, loading=false, save lock=false, canUnload=true olan bir belge kalabiliyordu. SDK destroy yalnızca pending store'ları tetiklediği için bu idle belge kapanışı süresiz bekletiyordu. CollaborationService kapanışta yalnızca SDK'nın güvenli bulduğu, yüklenmeyen idle belgeleri unload eder; sonra normal destroy çalışır. Aktif/pending belgeler aynı SDK yaşam döngüsünde kalır. Önce 1 failed/21 passed, sonra 22/22 hook testi geçti. Test harness'ında özel shutdown sırası veya kapanış hatasını yutan timeout workaround'u bırakılmadı.

Düzeltmeler sonrası gerçek Firefox iki kullanıcı/flush/reload/kapanış kabulü 14,24 saniyede geçti. Hedefli bu koşudaki 43 filtrelenmiş vaka kabul toplamına eklenmez; son kabul için bütün süit yeniden yürütülür. Kesilmiş/bekleyen önceki koşuların exit 130 veya tamamlanmamış logları başarı değildir.

## Gerçek rol matrisi

On yerleşik tenant rolü, sentetik aktif kullanıcılar ve açık `*` test kapsamlarıyla sınanır: tenant_admin, security_auditor, script_designer, script_approver, integration_engineer, campaign_manager, supervisor, agent, report_viewer, api_client. Beklenen menüler testte bağımsız ve sabit tanımlıdır; beklenti üretim ability fonksiyonundan türetilmez. İki uygulamada menüler, session/permissions cevabı ve script oluşturamayan roller için görünmeyen buton + gerçek HTTP 403 + oluşmamış DB kaydı doğrulanır. Platform super_admin bu yeni browser matrisine dahil değildir; önceki API/authz testleri ayrı kanıttır. Kampanya akışı tenant_admin yerine normal campaign_manager ile yürütülür.

Secret oluşturma/değiştirme gerçek API'den geçer. Cevapta value/ciphertext bulunmadığı, parola alanının temizlendiği, DB ciphertext'inin düz metin içermediği/değiştiği, version artışı ve reload sonrası boş parola alanı kontrol edilir. Master key test süresince rastgele bellekte üretilir, loglanmaz ve eski ortam değeri geri yüklenir. İlk 503, anahtarın yapılandırılmadığı test ortamının fail-closed davranışıydı; üretim fallback'i eklenmedi.

## Nihai kontroller

- Monorepo test/lint/typecheck/build: **77/77 görev**, 33 cache / 44 yeniden yürütme; **4.978 Vitest + 4 docs Node testi** geçti. Son envanter Designer 317, Admin 101, API 1.828. Önceki 4.974/4.977 koşuları tarihsel teşhis kaydıdır ve toplama tekrar eklenmez. Katmanların tekrarları benzersiz toplam gibi sunulmaz.
- Coverage kapısı: 18 workspace başarılı; API lines/branches 92,89/85,62; Admin 94,63/88,20; Designer 91,54/80,54; Agent 93,52/84,91; hub 86,40/75,17.
- **Gerçek backend/IdP/TLS/WS + Agent + Chromium ürün süiti 322/322** (275 backend + 3 Agent + 44 ürün). Ürün Firefox **44/44**, WebKit **44/44**; üç tarayıcıda 132 ürün senaryosu. Son tam koşularda skip 0. Sonraki katalog değişikliği ayrıca iki dilde AI retry regresyonuyla doğrulandı.
- Verification yedi dosyanın tamamı typed ESLint ve TypeScript denetiminden geçti. Hız/yetki/axe/coverage kuralları gevşetilmedi; skip/quarantine eklenmedi.

## Teşhis koşuları ve sınırlar

İlk browser koşularındaki yanlış locator adları ve eksik test master key'i ayrı teşhis loglarıdır. WebKit'in bir koşusunda 34 passed/10 failed görüldü: menü okuyan test yardımcısındaki string evaluateAll fonksiyonu sonuç döndürmüyordu. Test yardımcısı Playwright locator okumalarına geçirildi. Firefox tekrarında 43 passed/1 failed görüldü: odadan çıkışın kendi reload'u ile testin ek reload'u yarışıyordu. Test artık gerçek flush sonrası load ve yeniden görünür Join kontrolünü bekler; navigasyon hatası yutulmaz ve retry eklenmez. Bu başarısız koşular kabul sonucu değildir. Kabul için bütün süit son kodla yeniden yürütülür.

Bu matris her düğmenin bütün rol/veri/ağ kombinasyonlarını kapsamaz. Yeni browser kanıtı kampanya lifecycle/çatışma, secret kayıt/rotasyon ve menü/script-write yetkileridir. Lisanslı Genesys/Avaya/Engage uçları, müşteri IdP politikaları, canlı AI ve PCI sağlayıcıları için gerçek yetkili hesap/uç kabulü yoktur; önceki yerel alternatif kanıtlar o sistemlerin kabulü yerine geçmez. Üretim trafik yükü ve evrensel sıfır-hata iddiası çıkarılmaz. Bunlar çalışıyor olarak işaretlenmedi. Sunucu/deployment istisnası korunur.

Kanıt dizini: `docs/verification/evidence/product-actions-20261005/`. Loglar, ekran görüntüleri ve son kaynak SHA-256 kayıtları manifestte bulunur; repo başlangıç commit'i olmadığı için Git HEAD null olarak tutulur.
