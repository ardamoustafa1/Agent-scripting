# Açık çalışma alanı — 2026-10-05

Durum: ✅ yerel tasarım ve doğrulama tamamlandı.

## Tasarım kararı

Kullanıcının talebi: lacivert sol navigasyonu korumak; sağ çalışma alanını açık, profesyonel bir yüzey düzenine geçirmek.

IBM Carbon [renk rehberi](https://www.carbondesignsystem.com/building-blocks/foundations/color/guidelines) aynı uygulamada açık içerik alanı ile ayrı temalı koyu kabuk kullanılmasını destekler. Atlassian [elevation rehberi](https://atlassian.design/foundations/elevation/) yüzey hiyerarşisini semantik tasarım tokenlarıyla tanımlar. Uygulanan yorum: lacivert navigasyon, nötr gri çalışma zemini, beyaz üst çubuk ve beyaz içerik kartları; vurgu renkleri sınırlı ikonlar ve durumlar için kullanılır.

- Sol menü: mevcut `#101225` ve turkuaz aktif navigasyon korunur.
- Açık çalışma zemini: `#f6f7f9`; yardımcı yüzey: `#f0f2f5`; kartlar: `#ffffff`.
- Metin: `#1d2939`; ikincil metin: `#526071`; panel ayracı: `#e2e6ec`.
- Analitik ilk KPI kartının lacivert dolgusu kaldırıldı. Tüm KPI, filtre, boş durum ve zamanlama panelleri aynı yüzey hiyerarşisinde.
- Yeni veya okunamayan tema tercihi açık temaya döner. Açıkça seçilmiş sistem/koyu/yüksek kontrast tercihlerinin davranışı korunur. Kullanıcının açık Chrome Studio ekranında Açık seçildi ve görsel doğrulandı.

## Doğrulama

- Regresyon testi önce eski `system` varsayılanında başarısız oldu, yeni açık varsayılanla geçti.
- UI tema/token/brand/analitik birim testleri: 47/47.
- Studio shell ve analitik davranış birim testleri: 31/31.
- Playwright: 23/23. TR/EN × light/dark/high-contrast × 320/768/1440, boş ve dolu analitik ekranları; axe, yatay taşma, ekran görüntüsü karşılaştırmaları, rapor işlemleri ve komut menüsü doğrulandı. Koyu OS üzerinde yeni oturumun açık çalışma alanı + lacivert rail kullanımı ayrıca doğrulandı.
- UI ve Studio lint/typecheck başarılı. Studio production build başarılı; mevcut büyük chunk uyarısı devam ediyor. Değişen dosyalar Prettier ile kontrol edildi.
- Eski hello fixture API globu Vite kaynak URL’lerini de yakalıyordu; yalnız `/api/` kökünü eşleyen predicate ile düzeltildi. İlk iki eşzamanlı tarayıcı koşusunun çıktı klasörü çakışması son seri koşuda giderildi; başarısız koşular kabul sayılmadı.
- Kanıt: `evidence/light-workspace-20261005/`; canlı Chrome görüntüsü: `../../artifacts/studio-light-workspace.png`.

Takip: ürün sahibi yeni açık görünümü yerel Studio üzerinde değerlendirebilir.

## İkinci tasarım turu — kontrollü koyu vurgular

Kullanıcı açık zemini onayladı; kart ve başlıklarda daha güçlü renk hiyerarşisi istedi. Açık arka plan tokenları korunarak ana Oturumlar kartına lacivert yüzey, turkuaz sayı/ikon ve üst çizgi eklendi. Diğer göstergeler beyaz yüzey, ölçülü mavi/gri ikon alanı ve ince üst vurgu kullanır. Rapor filtresi hafif mavi başlık bandıyla form alanlarından ayrılır. Zamanlanmış raporun başlığı lacivert/turkuaz, formu açık kalır. Ana başlık ağırlığı artırıldı; CSV eylemi koyu birincil düğmeyle öne çıkarıldı. Tüm renkler mevcut semantik ve marka tokenlarını kullanır; gerçek ölçüm veya iş davranışı değişmez.

UI token/brand/analitik birim testleri 40/40, TR/EN × üç tema × üç ekran boyutu ve rapor işlemleri Playwright 19/19 geçti. UI lint/typecheck ve Studio build başarılı. Desktop 1440 ve mobil 320 görüntüleri incelendi; canlı Chrome ekranı doğrulandı. Kanıt: `evidence/accent-workspace-20261005/`; canlı görüntü: `../../artifacts/studio-accent-workspace.png`.

Güncellenmiş baselinelara karşı ayrı, update içermeyen görsel karşılaştırma koşusu: 4/4 (TR light 320/1440, dark 768, high-contrast 320; boş ve dolu ekranlar).
