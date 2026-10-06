# Studio — sürüm tablosu ve yayın ekranı tasarım düzeltmesi

2026-10-05. Kullanıcının iki ekran görüntüsündeki tablo hücresine sıkışan regresyon ve dağınık yayın başlığı düzeltildi. Shared lifecycle card ve regression panel düzenleri de güçlendirildi. Bütün olası veri kombinasyonlarının hatasız tasarımı veya production kabulü iddia edilmez.

## Değişiklikler

- Tam regression formu artık table `<td>` içindeki `<details>` altında açılmaz. Her sürüm kısa bir button ile design-system Dialog açar; doğru script/version/state korunur. Panel içeriği portal ile hücre dışında; başlık yalnız bir kez. Klavye focus trap, Escape ve trigger'a focus dönüşü aynı dialog bileşeni üzerinden.
- Tablo review link'i ziyaret durumunda tarayıcı mor/altı çizili default görünümüne dönmez; icon ve ortak action stiliyle gösterilir. Tarihler locale ile okunabilir kısa format; machine datetime/title korunur. Uzun regression button metni hücrede sarılır, kesilmez.
- Yayın başlığında identity/icon/name/version bir grup, durum/editör başka grup; back ayrı, bütün navigation link'leri tutarlı. Uzun isim wrap olur; <=1000px actions alt satıra ve iki card tek kolona geçer.
- Regression CSS doğrudan panelden yüklenir; preview route'unun daha önce açılmış olmasına bağımlı değildir. Button ve açıklamalar normal white-space, min/max width ve wrap; checksum/scenario/assertion metinleri taşmaz. Panel bütün kullanım yerlerinde aynı davranışı alır.
- Shared lifecycle card içinde badge tam satıra yayılmaz; boş listeler fazladan alan bırakmaz. Validation/review boş durumları anlamlı TR/EN metinlerle gösterilir. Card button'ları dar alanda sarılır.
- Tam UI denetiminde welcome guide progress yazısı için color-contrast hatası çıktı; primary text token ile contrast güçlendirildi. Axe kapısı korunur.

## Regresyon ve yerel görsel kanıt

Önce yeni birim test: 1 başarısız/8 başarılı — eski tablo içi panel ve dialog yokluğu. Son Script/Release/Regression hedefi 21/21. Tam Designer unit/coverage 342/342, 49 dosya. i18n 6/6. Typecheck/lint/build başarılı; mevcut büyük bundle uyarısı sürer.

Yeni 10 Chromium layout senaryosu: TR light/dark/high-contrast ×320/768/1440 ve EN light1440; uzun script adı, hücre dışı dialog, run button ve report overflow, keyboard Escape/focus, review navigation, title/action ayrışma ve axe. Lifecycle/Preview ile hedef 26/26. Fixtures sentetik API responses; live backend acceptance olarak sunulmaz.

Son normal tam Chromium **210/210**, 1.9 dakika; evidence/chromium-full.log içinde kayıtlıdır. Önceki geniş koşu 197 başarılı/13 başarısız: 9 analytics screenshot yalnız build deployment etiketi farkı, 3 mobile editor full-page sidebar snapshot scroll konumu, 1 welcome contrast. Analytics design için production değişikliği veya baseline bypass yapılmadı; görsel suite development-mode artifact ile eski development referanslarıyla eşleştirildi. Editor screenshot öncesi scroll(0,0) ile deterministic; gerçek card/control değişimleri ve progress rengi için incelenmiş referanslar güncellendi. Axe/tolerance/timeout gevşetilmedi.

İlk yeni browser suite 10 başarısız: report fixture wrong field `scriptVersionId`, beklenen strict schema `version`; doğru fixture ile 26/26. İlk build de test callback'inde `document` isimli local fixture'ın DOM document type'ını shadow etmesi nedeniyle başarısızdı; scriptDocument ile düzeltildi. İlk lint üç stil/type hatası, düzeltildi. Hatalı deneme logları korunur; test hataları product kabulü gibi yorumlanmaz.

Canlı oturumlu Chrome'da QA kargo hikayesi/version1 tablosu, dialog ve release görünümü incelendi. Kaydedilmiş iki scenario çalıştırıldı ve ikisi successful görüldü. Yayın/approval/assignment değiştirilmedi. Artifacts:

- `artifacts/regression-dialog-final.jpg`
- `artifacts/regression-result-final.jpg`
- `artifacts/release-layout-final.jpg`

Kanıt ve source SHA manifesti: `docs/verification/evidence/lifecycle-layout-20261005/`. Bu tur yalnız UI/i18n/test/source build ve kendi sentetik QA regression çalıştırmasıdır; kullanıcı script içeriği/production infrastructure değiştirilmedi.
