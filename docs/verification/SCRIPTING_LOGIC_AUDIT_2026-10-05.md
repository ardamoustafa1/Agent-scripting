# Scripting mantık ve kontrol denetimi — 2026-10-05

## Kapsam

Önceki [scripting hikaye denetiminin](SCRIPTING_STORY_AUDIT_2026-10-05.md) ardından iç editör işlemleri daha derin denendi. Kullanıcının son talebi doğrultusunda dış entegrasyonlar ve canlı AI bu turda kapsam dışıdır. Testler bütün olası veri ve bileşen birleşimlerinin hatasız olduğunu kanıtlamaz; aşağıdaki tekrar üretilebilir davranışları doğrular.

## Bulunan ve düzeltilen hatalar

| Sorun | Tekrar üretme | Son davranış | Kanıt |
| --- | --- | --- | --- |
| Gruplama seçim sırasına göre bileşenleri yeniden sıralıyordu | Son kardeşi, ardından ilk kardeşi seçip Grupla | Ortak parent içindeki tuval sırası korunur; ungroup ve undo aynı sırayı korur. Aynı root sıralaması copy/duplicate işlemlerinde de kullanılır. | regressions-before.log, regressions-after.log; yeni Chromium senaryosu |
| Gruptan çıkar toolbar ile seçim köklerini farklı yorumluyordu | Çocuğu önce, grubu sonra seç; veya gruba ayrı bir root ekle | Tek seçilmiş root grup çözülür. Birden fazla root varsa işlem reddedilir ve belge değişmez. | ungroup-before.log iki başarısız regresyon; ungroup-after.log 10 başarılı |
| Liste/aralık operatöründen skaler operatöre geçiş geçersiz değer bırakıyordu | Sayısal Between [10,20] → Greater than; string In → Equal | Bilinen skaler field tipine uygun değer ve editör üretilir: number 0, boolean false, string/date/enum boş metin. Array/object/unknown alanlarının mevcut semantiği korunur. | İki yeni birim regresyonu; kaydedilen PUT belgesini kontrol eden Chromium testi |
| In → Not in geçişi kullanıcının listesini siliyordu | [A,B] girip In → Not in | İki liste operatörü arasında seçenekler korunur. | list-switch-before.log başarısız; list-switch-after.log 18 başarılı |
| JSON değer editörü undo sonrası eski metni gösteriyordu | [0,1] → [10,20], blur, Undo/Redo | Görünen değer belgeyle birlikte geri alınır/yinelenir; değişmiş committed değere göre yerel taslak yenilenir. Geçersiz, henüz kaydedilmemiş taslak korunur. | Yeni birim ve Chromium regresyonu; canlı Chrome kontrolü |
| Kural formu geniş ekranda gereksiz uzuyor, değer alanı görünümün altında kalıyordu | Tam ekran Rules panelinde Alan/Operatör/Değer | Form genişliği sınırlandı; seçim ve Kural ekle aynı araç satırında. Koşul alanları yeterli genişlikte yan yana, dar panelde alt alta; 390px taşma kontrolü. | layout-before.log başarısız geometri kontrolü; son Chromium testi ve rule-layout-final.png |

Yedi yeni birim regresyonu ve iki yeni Chromium senaryosu eklendi. Regresyonlar önce hata veren uygulamada çalıştırıldı; test kapıları ve görsel toleranslar gevşetilmedi.

## Son doğrulama

- Chromium son üretim derlemesinde normal tam koşu **200/200**, 1,7 dakika: [log](evidence/scripting-logic-20261005/browser-final.log). Yeni geniş/dar kural formu geometri kontrolleri dahil; referans güncelleme koşusu değildir.
- Gerçek frontend/API/PostgreSQL/Redis/NATS: seçilen üç iç senaryo **3/3** geçti, 42 diğer senaryo seçilmedi: [log](evidence/scripting-logic-20261005/real-internal.log). UI ile script/ilk taslak oluşturma ve DB kalıcılığı; iki dilli kargo hikayesi, düzenleme ve önizleme; iki ayrı kullanıcıyla ortak düzenleme ve oda kapanışı sonrası DB kaydı.
- Son TypeScript, lint ve üretim build başarılı: typecheck-layout.log, lint-layout.log, build-layout.log. Büyük bundle uyarısı devam ediyor.
- Son tam birim koşusu **341/341**, 49 dosya, 62,86s: [log](evidence/scripting-logic-20261005/unit-final.log). Coverage statement %89,59, branch %80,97, function %87,45, line %91,57; eşikler korunur. Tasarım değişiminden sonra eşzamanlı Chromium yükü altında önceki tekrar 340/341, bir toolbar davranış testi 5s test timeout verdi. Assertion ve timeout değiştirilmeden seri tekrar 341/341 geçti; unit-layout.log saklandı.

## Canlı kullanım kontrolü

Kullanıcının eski scripti değiştirilmeden, önceki turda oluşturulmuş `QA - Kargo destek hikayesi` kullanıldı:

http://localhost:5173/scripts/01a10c66-a79a-774e-b8a2-875bb22c5088/versions/1/edit

- `qaParcelCount` adlı session number değişkeni, sentetik varsayılan 5 eklendi.
- `QA · Sayısal operatör ve geri alma kontrolü` kuralı oluşturuldu.
- Between [0,1] → [10,20] → Undo [0,1] → Redo [10,20] elle görüldü.
- Greater than seçildiğinde textarea yerine sayısal input geldi ve 0 başlangıç değeri görüldü. 5 girildi, Kaydedildi ve 0 doğrulama hatası görüldü.
- Yeni formun Alan / Operatör / Değer satırı canlı Chrome ekranında incelendi. [Ekran kanıtı](evidence/scripting-logic-20261005/rule-layout-final.png).

Bu ek kural bir editör kontrol örneğidir; kargo akışına koşul olarak bağlandığı iddia edilmez. Önceki iki sayfalı hikaye ve kaydedilmiş senaryolar korunur.

## Kanıtların yorumlanması

- 72 bileşen ekleme/beş inspector sekmesi/undo/redo testleri tam Chromium koşusuna dahildir. Her bileşenin her domain birleşimi denenmiş değildir.
- Gerçek API testleri bu turda seçilmiş üç iç senaryodur; 45 senaryonun tamamı tekrar çalıştırılmış gibi raporlanmaz.
- Önceki denetimde aralıklı ortak düzenleme güncelleme gecikmesi görülmüştü. Bu turdaki geçiş, onun kök nedeninin çözüldüğü anlamına gelmez; collaboration uygulamasına bu turda kök neden düzeltmesi yapılmadı.
- İlk tam Chromium koşusu sırasında ikinci Playwright koşusu aynı test-results dizinini temizledi. 196 başarılı / 4 ENOENT artifact hatası olan log browser-confirmed.log saklandı. Koşular seri olarak yeniden çalıştırıldı. Bu ürün davranışındaki hata olarak sayılmaz.
- Son UI/logic kodunun kaynak SHA-256 değerleri manifest.json içinde; eski rapor ve başarısız loglar tarihsel kanıt olarak korunur.
