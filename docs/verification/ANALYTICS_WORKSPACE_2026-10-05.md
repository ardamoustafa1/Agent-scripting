# Analitik ve Studio üst çubuğu — 5 Ekim 2026

Kullanıcının paylaştığı analitik ekranı ve üst çubuk yeniden düzenlendi. Backend sözleşmeleri ve erişim yetkileri korunur. Ortak AnalyticsDashboard görünümü bütün kullanıcılarında aynı tasarım tokenlarını kullanır; Designer üst çubuğu bütün Studio sayfalarına uygulanır.

Analitik tek bir kapsam paneli, dört ölçüm kartı, sonuç alanı ve ayrı rapor planlama paneli kullanır. Tarih başlangıcı/bitişi, kampanya kimliği, dokuz kanal ve ekip kimliği alanları görünürdür. “Son 7 gün / Son 30 gün” tarih aralığını güncellerken boyut filtrelerini korur; filtre temizleme tarih aralığını korur. ID girişleri serbest giriş olarak kalır, kapsam ve kimlik açıklamaları eklenir.

Veri olmayan durumda sahte seri veya oran gösterilmez: gerçek oturum sayısı 0 ise 0, hesaplanamayan ölçümler — gösterilir. Açıklama ve seçili tarih aralığı boş durumu anlatır. Yükleme/hata/retry ve işlem hata durumları kalır. Zamanlanmış raporda UTC, alıcı yetkileri ve kaydetme/silme geri bildirimi açıklanır.

Üst çubuk kompakt organizasyon/ortam alanı, belirgin arama, dil/tema/bildirim/kullanıcı kontrolleri kullanır. Select etiketleri görsel olarak sadeleştirilir, erişilebilir isimleri kalır. Tablo ve kartların yerini değiştiren otomatik route focus kaydırması `preventScroll` ile giderilir; ana içerik focusu korunur.

## Özellik koruma kaydı

| Alan | Korunan işlevler |
| --- | --- |
| Filtreler | Başlangıç/bitiş UTC, kampanya, kanal (dokuz değer), ekip; mevcut API doğrulaması ve filtre query parametreleri |
| Dışa aktarma | CSV ve XLSX, yetki kontrolü, gerçek dosya indirme, busy/error koruması |
| Ölçümler | Oturum, tamamlanma, ortalama süre, zorunlu metin uyumu; null/0 ayrımı |
| Detaylar | Script/agent/variant tabloları; script/outcome/agent grafikleri; Sankey ve tam geçiş tablosu; sayfa hunisi, kaynak gecikme/hata, A/B istatistikleri |
| Canlı operasyon | Kampanya aktif/tamamlanan sayıları, aktif oturum ayrıntıları, mevcut 10s yenileme ve cohort/üretim zamanı |
| Rapor planı | Günlük/haftalık, UTC saat, alıcı kimlikleri, plan listeleme ve silme; POST/DELETE CSRF; mevcut Report yetkileri |
| Üst çubuk | Organizasyon değişimi/SSO açıklaması, ortam seçimi, arama/⌘ veya Ctrl K, dil, tema, bildirim/onay yönlendirmesi, rehber ve logout |

## Doğrulama

- Monorepo lint/typecheck/build/test: 77/77 görev; 71 cache, 6 yeniden yürütülen. 4.993 Vitest ve 4 Node Docs testi başarılı.
- Coverage: 18/18 workspace ve güvenlik kapıları başarılı.
- Tam Designer Chromium: güncelleme koşusu 96/96, son güncellemesiz normal koşu 96/96. Yeni analitik 19 vaka bu sayının içindedir, tekrar eklenmez.
- Ortak UI analitik: güncelleme 6/6, normal kıyas 6/6.
- TR/EN: 1.617/1.617 katalog anahtarı; kaynak formatı başarılı.

Son kabul logları `docs/verification/evidence/analytics-workspace-20261005/` altında tutulur. Önce filtre temizleme için başarısız regresyon koşuldu. Odaklı analitik birim testleri, Designer request/CSRF/yetki davranışları ve Shell testleri bütün monorepo koşusunda doğrulanır.

Yeni gerçek Designer UI testleri iki dil × üç tema × 320/768/1440px için boş ve dolu ekran, bütün sayfa axe ve taşma kontrolleri içerir. Boş fixture 0 gerçek oturumla, dolu fixture sentetik ölçümlerle doğrulanır. İşlem kabulü CSV/XLSX indirme, filtre temizleme, CSRF ile rapor oluşturma/silme ve üst çubuk menülerini yürütür. Referanslar güncellemesiz normal kıyasla tekrar kontrol edilir. Ortak bileşen katalog analitiği üç tema/iki dil için axe/klavye ve görsel kıyasla doğrulanır.

İlk tarayıcı teşhisinde test rolü Report erişimine sahip değildi; yetkili sentetik rol eklendi. Bir boş fixture number bekleyen completionRate alanına null gönderdi; fixture gerçek şemaya uyarlandı. H2 üzerinde status rolü axe kontrolünde reddedildi; status ayrı kapsayıcıya taşındı. Kanal seçimi erişilebilir combobox adıyla hedeflendi. Bunlar başarılı sayılmaz, teşhis logları korunur. Geliştirme sunucusu coverage çıktılarıyla eş zamanlı HMR ürettiğinden son tam 96/96 tarayıcı kabulü izole production preview üzerinden yürütüldü. Eşikler ve axe kuralları gevşetilmedi.

Production deployment, commit/push veya gerçek kullanıcı verisi değişikliği yapılmadı. Ekran kanıtlarındaki dolu sayılar sentetik test verisidir.
