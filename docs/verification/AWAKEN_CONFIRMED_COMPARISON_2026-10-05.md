# Verbis / Awaken — doğrulanmış alanların karşılaştırması

Tarih: 2026-10-05. Awaken tarafı resmî Agent Guidance dokümantasyonuna dayanır; rakip uygulama üzerinde aynı görev için süre, hata veya performans ölçümü yapılmadı. Verbis tarafında aşağıdaki yerel davranışlar test edildi. Özelliklerin iki üründe bulunması, eşit kalite veya genel üstünlük kanıtı değildir.

| Alan | Awaken belge kanıtı | Verbis kanıtı / sonuç |
| --- | --- | --- |
| Değişken yönetimine erişim | [System and Script Variables](https://docs.awaken.io/ag/core/system_and_script_variables.html): tasarımcıda doğrudan Variables düğmesi | Önceden editör modu menüsündeydi. Bu oturumda Ekran/Akış/Kurallar/Değişkenler/Önizleme düğmeleri eklendi. Belgeyi kaybetmeden tek tık geçiş ve gereksiz kayıt oluşmaması birim testinde doğrulandı. Somut erişim farkı kapatıldı. |
| Sayfa geçişi ve koşullu akış | [GoToPage](https://docs.awaken.io/ag/core/gotopage.html): sayfa seçimi ve koşullu düğme seçenekleri | Yeni script oluşturma, bileşen sürükleme, karar/servis akışı ve kural oluşturma Playwright senaryosu geçti. Bu temel yetenekler mevcut; karmaşık müşteri akışlarında hız/kalite üstünlüğü ölçülmedi. |
| Tasarım alanının kullanılabilirliği | Rakibin tasarımcı tuval boyutu ve sığdırma davranışı için karşılaştırmalı ölçüm yok | Verbis normal 1440×900 ekranda tuval yüksekliği >450px; tam ekran alanı genişletir ve seçim korunur. Yeni Tuvale sığdır düğmesi 1280px tasarım genişliğini görünür alana getirir, belgeyi değiştirmez. Kullanıcının küçük alan şikâyetine somut iyileştirme. |
| Düzenleme güvenilirliği | Rakibin aynı test senaryoları için ölçülmüş sonuç yok | Sürükle/bırak, katman sıralama, undo/redo, iyimser sürüm ve CSRF kayıt isteği bu oturumdaki tarayıcı süitinde geçti. Kontrollü API yanıtları kullanılır; gerçek API/veritabanı kabulü değildir. |
| Kampanya / yayın yaşam döngüsü | [Campaign Popping](https://docs.awaken.io/ia/core/campaign_popping.html): kampanya izinleri ve yayınlanan aktif workflow sürümü | Verbis yaşam döngüsü için önceki gerçek tarayıcı raporu ayrı kanıttır: [PRODUCT_REAL_BROWSER_2026-10-04.md](PRODUCT_REAL_BROWSER_2026-10-04.md). Bu oturumda kampanya/yayın işlemleri yeniden çalıştırılmadı. Üstünlük sonucu yok. |
| Telefon platformu entegrasyonu | [Integrations](https://docs.awaken.io/ag/core/integrations.html), [Genesys helper functions](https://docs.awaken.io/ag/core/genesys_cloud_helper_functions_and_sdk.html): platforma bağlı çağrı işlevleri; Designer Preview sınırlamaları | Gerçek telefon sağlayıcısı ve müşteri ortamında canlı çağrı/writeback bu oturumda doğrulanmadı. Bu alanda Verbis'in daha iyi olduğu kesinleştirilemez. |
| AI yardımı | [Agent Assist Studio](https://docs.awaken.io/ag/core/agent_assist_studio.html): niyet/kategori/aksiyon ve AI quick actions | Canlı müşteri AI sağlayıcısında kalite/gecikme karşılaştırması yapılmadı. Üstünlük sonucu yok. Agent Assist yapılandırmasının sürüm davranışı, rakibin workflow sürümleriyle karıştırılmamalı. |

## Bu oturumda yapılan iyileştirmeler

- Beş editör aracı için doğrudan geçiş düğmeleri; mevcut mod seçimi de çalışır.
- 74 bileşen ve kategori TR/EN etiketleri: `box` → Kapsayıcı, `button` → Düğme, `webService` → Web servisi. Arama hem teknik türü hem çevrilmiş adı bulur; kaydedilen tür/kimlik değişmez.
- Çekirdek özellik alanları mevcut çevrilmiş özellik etiketlerini kullanır.
- `base` gibi ekran presetleri Mobil / Tablet / Masaüstü ve piksel genişliği ile gösterilir.
- Tuvale sığdır; mevcut alan ve tasarım genişliğine göre %10–%200 yakınlaştırma. Belge, seçim ve kayıt davranışı korunur.

## Doğrulama

- Editor/canvas/layers/inspector davranış birim testleri: 29/29.
- TR/EN katalog testleri: 6/6.
- Editor + editor-layout Playwright: 19/19; üç tema, 320/768/1440 genişlik, erişilebilirlik, çakışma ve tam ekran/sığdırma kontrolleri. Görsel referanslar güncellendikten sonra normal karşılaştırma koşusu da geçti.
- Studio lint ve üretim build başarılı. Build'de mevcut büyük bundle uyarısı sürüyor; yükleme performansı üstünlüğü iddia edilmez.
- Oturum açılmış gerçek Chrome ekranında tam ekran ve sığdırma kontrol edildi; durum Kaydedildi, yakınlaştırma %200. [Görsel](../../artifacts/studio-editor-comparison-improved.png).

Genel sonuç: değişken erişimi farkı düzeltildi, tasarım alanı ve etiketler iyileştirildi. Mevcut kanıt genel bir “Awaken'dan daha iyi” sonucu kurmaz. Açık kabul başlıkları: gerçek platformda çağrı/writeback, müşteri SSO, AI sağlayıcı, yük/gecikme ve aynı görevde oluşturma süresi/hata oranı.
