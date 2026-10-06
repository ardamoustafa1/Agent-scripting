# Verbis — bütünleşik ürün tasarımı, 5 Ekim 2026

## Kapsam

Onaylanan giriş dili Designer, Admin, Agent, dokümantasyon ve ortak UI/runtime bileşenlerine taşındı. Sunucu production hazırlığı/deploy ve gerçek kullanıcı verisine müdahale yapılmadı. Ekran ailesi aynı kimliği kullanır; çalışma yoğunlukları korunur.

| Alan | Taşınan yüzeyler |
| --- | --- |
| Designer | Giriş; analitik, kampanyalar, scriptler, ekranlar, entegrasyonlar, değişkenler, AI, şablonlar, sürümler, ayarlar; canvas/flow/rule/preview; detaylar, menüler ve dialoglar |
| Admin | Giriş ve break-glass; analitik, tenant yönetimi, kimlik/SSO, kullanıcılar, connectorlar, secrets, AI, audit, güvenlik, veri, branding, simülatör, sistem sağlığı |
| Agent | Giriş; güvenli launch ve Genesys bağlantı sonucu; bekleme, etkileşim, script runtime, sidebar, wrap-up, tamamlandı, supervisor ve tercihler |
| Ortak sistem | Açık/koyu/yüksek kontrast tokenları; buton/input/select, tablo, kart, dialog/sheet/menu, AI/analitik, bileşen katalogları, focus ve reduced-motion |
| Dokümantasyon | 71 oluşturulan sayfanın ortak çerçevesi; header/sidebar/TOC, TR/EN arama/tema kontrolleri ve altı SVG rehber şeması |

## Görsel sözleşme

Marka alanları aynı lacivert `brand-bg`, buz mavisi `brand-accent` ve okunabilir `brand-text/muted` tokenlarına bağlıdır. High-contrast marka tokenları siyah/beyaz/sarıdır. Açık içerikte ana aksiyonlar girişteki lacivertle, koyu içerikte buz mavisiyle çalışır; semantik başarı/hata/uyarı renkleri ayrı kalır. Tenant branding ve kontrast denetimi korunur.

Designer/Admin masaüstü menüsü 224px, header ölçüsü 76px; Agent header aynı kimlikle kendi yoğun düzenini korur. Metin hiyerarşisi, küçük kontrol köşeleri, sade kartlar, form hover/focus ve seçili gezinme göstergeleri ortaklaştırıldı. Dar ekran ve embedded Agent stilleri korunur. Çalışma ekranlarına sürekli dekoratif animasyon eklenmedi; hareket girişte akışı, kontrollerde etkileşimi anlatır.

`AccessLayout` ve `ScriptAtlas` ortak UI exportlarıdır. Aynı giriş düzeni üç uygulamada kullanılır; auth/discovery/SSO/break-glass mantığı uygulamaya ait kalır. SVG gradient kimlikleri birden çok örnekte çakışmaz. Pause/dil değişimi form stateini yeniden oluşturmaz. TR/EN ortak copy `common.access` altında tutulur.

## Doğrulama

Son sonuçlar kanıt loglarında tutulur; teşhis/tekrar koşuları benzersiz test sayısı gibi eklenmez. Görsel referanslar axe ve gözle inceleme sonrası güncellendi; normal kıyas ayrıca yürütüldü. Designer/Admin/Agent açık/koyu referansları incelendi. Gerçek backend ekranları ayrı izole Testcontainers tenantlarıyla yürütüldü.

| Kontrol | Sonuç |
| --- | --- |
| Monorepo lint/typecheck/build/test | 77/77 görev başarılı; 4.991 Vitest + 4 Node Docs = 4.995 test; son komutta 70 cache ve 7 yeniden yürütülen görev |
| Coverage gate | 18/18 workspace ve güvenlik kapsamı kapıları başarılı |
| Gerçek backend ürün kabulü | Chromium, Firefox ve WebKit ayrı ayrı 44/44; skip 0 |
| Designer normal Chromium kıyas/akış | 65/65 |
| Admin normal Chromium + super-admin tenant | 21/21 + hedefli tenant 1/1; toplam 22 benzersiz vaka |
| Agent normal Chromium | 27 başarılı, 2 koşullu skip |
| Ortak UI | İlk axe/görsel güncelleme 167/167; normal kıyas 166 başarılı/1 soğuk yükleme timeout, sonra ilgili analytics 6/6 normal kıyas; 161 tasarım sistemi + 6 analytics benzersiz vaka doğrulandı |
| Runtime bileşen kataloğu | 208/208 üç tema, klavye/axe ve TR/EN/RTL |
| Docs | 36/36 üç tarayıcı: gerçek sayfa için HTTP 200, mobil/masaüstü, iki dil ve iki tema axe; arama/tema/dil akışları |
| Ek kontroller | Root script lint, audit 2/2, policy 5/5, test TS/lint, TR/EN 1.584/1.584 katalog ve değişen kaynak formatı başarılı |

Yeni `AccessLayout`/`ScriptAtlas` regresyonları uygulama formunun dil/pause değişiminde korunmasını ve çoklu SVG gradient kimliklerini doğrular. Yeni Admin/Agent giriş testleri her uygulamada 320/768/1440px, TR/EN axe ve auth öncesi ayrıcalıklı veri fetch edilmemesini kontrol eder. Teşhis koşularının başarısız sonuçları loglarda tutulur; başarı sayılarına eklenmez.

## Bulunan ve kapanan noktalar

- Ortak Admin erişim çerçevesi ile auth alt bölümü aynı erişilebilir adı taşıdı. Çerçeve kurumsal erişim olarak adlandırıldı; alt bölüm Yönetim başlığını korur. Axe landmark-unique düzeltildi.
- Açık Docs temasında mobil TOC marka zeminini aldı ancak metin koyu kaldı. Mobile TOC de marka metin tokenlarına bağlandı; TR/EN ve üç tarayıcıyla tekrar doğrulandı.
- Yeni ortak dil/hareket düğmeleri eski Agent testindeki genel button seçicisini belirsizleştirdi. Test SSO provider düğmesini adıyla hedefler; launch güvenliği korunur.
- API redaction testinde telefon fixture değeri `555` Pino timestampinde tesadüfen bulundu. Test yalnız gerçekten gönderilen payload alanlarını inceler ve bütün hassas alanlar için explicit redacted beklentisi içerir. Logger üretim kodu değiştirilmedi.
- Yoğun paralel tarayıcı/Node kontrollerinde Admin 5s test timeoutları görüldü. Eşikler ve güvenlik kuralları düşürülmedi; son monorepo kabulü kaynak yükü azaldığında geçti.
- Koyu Admin görsel incelemesinde native input placeholder kontrastı zayıf kaldı. Placeholder rengi/opacity ortak metin tokenına bağlandı; üç tema axe ve iki tema normal görsel kıyas tekrarlandı (5/5).
- İlk Docs tasarım testinde olmayan bir bölüm indexi 404 ekranına düştü. Başarılı test sonucu kabul sayılmadı; gerçek `first-script` sayfası ve explicit HTTP 200 beklentisi eklendi. Mobil kontrast bu doğru sayfada yakalandı.

## Kanıt ve sınırlar

`docs/verification/evidence/unified-product-design-20261005/` log, gerçek ürün ekranları, incelenmiş referanslar, ekran kapsamı ve kaynak hashlerini içerir. Önceki raporların sayıları yeni tasarım kabulüne eklenmez. Lisanslı gerçek connector/IdP/AI-PCI uçları ve üretim yükü bu tasarım kabulünün kapsamı değildir. Agent canlı-session performansı ve production edge CSP koşullu testleri atlanır; başarılı sayılmaz. Deployment, commit/push yapılmadı.
