# Verbis giriş ekranı — Script Atlas, 5 Ekim 2026

Kullanıcının talebi yalnız Designer giriş ekranının tasarımıdır. Çalışma alanı, Admin/Agent ve ortak renk tokenları değiştirilmedi. Mevcut BFF/SSO discovery, e-posta koruma, provider linkleri ve hata toparlanması korunur.

## Tasarım

- Koyu marka alanı ile açık erişim yüzeyi tam yükseklikte birleşir; ayrı yüzen form kartı kaldırıldı.
- Lacivert, buz mavisi ve yumuşak beyaz mevcut tasarım tokenlarından gelir. Büyük başlık, kısa açıklama ve net form hiyerarşisi kullanılır.
- Dalga görseli yerine scripting akışını anlatan vektör atlas vardır: başlangıç, üç karar yolu ve ortak sonuç. Hareketli ışık parçaları yollar boyunca ilerler. Rastgele müşteri/veri/performans sayısı gösterilmez.
- Dekoratif SVG WebGL/Three.js gerektirmez. Kullanıcı hareketi durdurup devam ettirebilir; reduced-motion çizgileri statik bırakır. Giriş alanı animasyonu beklemez.
- E-posta focus/hover, devam düğmesi, dil kontrolü ve mobil yüzey geçişleri yeniden düzenlendi. 320/390/768/1440px TR/EN ekranlar incelendi.

## Doğrulama

Chromium 9/9, Firefox 8/8, WebKit 8/8 giriş kontrolleri geçti. Bunlar TR/EN axe, taşma, hareketin ilerlemesi/tam durması/yeniden başlaması, reduced-motion, WebGL bulunmaması, klavyeyle provider discovery, 503 sonrası retry ve boş sağlayıcı durumunu içerir. Chromium ayrıca e-posta değişince tamamlanmış/geç gelen discovery sonuçlarının temizlenmesini doğrular.

Designer light/dark editör görsel kıyası 2/2 geçti; mevcut referanslar güncellenmedi. İlgili login/app birim testleri 12/12, i18n 6/6; Designer lint/typecheck ve production build geçti. Tam Designer 49 dosyada 327/327 geçti; coverage lines %91,67, branches %81,03 ve bütün tanımlı eşikler başarılı. i18n lint/typecheck, audit 2/2 ve değişen dosyaların Prettier kontrolü geçti.

İlk kontrol giriş reveal animasyonundaki opacity geçişinde metin kontrastını yakaladı. Reveal yalnız konumsal harekete dönüştürüldü; metin/form başlangıçtan itibaren tam kontrastla görünür. Pause doğrulaması CSS pause uygulanmasının sonraki iki çizim karesinde sabitlenmesini bekler, sonra tam eşit offset kontrolü yapar. Axe veya süre sınırları gevşetilmedi.

## Kanıt ve sınırlar

`docs/verification/evidence/script-atlas-login-20261005/` içinde loglar ve TR/EN masaüstü/mobil ekranlar bulunur. Son tasarım yerel uygulamada incelemeye hazırdır. Önceki kapsamlı ürün raporunun test sayıları bu dar tasarım değişikliğinin yeni sonuçları gibi sunulmaz. Deployment yapılmadı. Mevcut build büyük chunk uyarısı devam eder; bu adım bütün ürünün üretim hazır olduğunu yeniden onaylamaz.
