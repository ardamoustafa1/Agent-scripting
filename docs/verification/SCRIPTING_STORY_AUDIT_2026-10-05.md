# Scripting kullanım hikayesi ve kontrol denetimi — 2026-10-05

## Sonuç ve kapsam

Yeni bir kargo destek scripti oluşturuldu, kontroller kullanıldı ve bulunan hatalar düzeltildi. Bu rapor test edilmiş davranışları gösterir; her olası veri, bileşen birleşimi veya dış müşteri entegrasyonu için koşulsuz kabul değildir.

- Studio birim testleri: **334/334**, 49 dosya; coverage eşikleri değiştirilmedi. Statement %89,57, branch %80,97, function %87,44, line %91,56. [Log](evidence/scripting-story-20261005/unit-confirmed.log).
- Gerçek frontend/API/PostgreSQL/Redis/NATS matrisi: **45/45**; iki kullanıcıyla ortak düzenleme ve yeni hikaye dahil. Son adlandırılmış sayfalı koşu: [log](evidence/scripting-story-20261005/real-named-story.log). Önceki iki 45/45 koşunun logları da saklandı.
- i18n: **6/6**; lint, TypeScript kontrolü ve üretim build başarılı. Büyük bundle uyarısı devam ediyor.
- 72 eklenebilir bileşen için ayrı tarayıcı testi: ekle, beş inspector sekmesini aç, katmanda varlığını doğrula, geri al ve yinele. [Log](evidence/scripting-story-20261005/palette-all.log). Kayıtta 74 tür bulunur; iki eklenemeyen tür bu 72 testin içinde değildir.
- Chromium tam derlenmiş uygulama: **198/198**, 1,7 dakika; 72 yeni bileşen testi dahil. [Normal koşu logu](evidence/scripting-story-20261005/browser-built-confirmed.log). Referans güncelleme modunda alınmış sonuç değildir.
- Root audit/i18n katalog kontrolü **2/2**; TypeScript audit harness kontrolü başarılı. Son lint: [log](evidence/scripting-story-20261005/lint-repaired.log). Yeni testlerin yalnızca generic DOM tipi/act callback yazımı lint için düzeltildi ve ilgili 17 davranış testi yeniden geçti.

## Kullanılabilir test hikayesi

Canlı geliştirme ortamında yeni `QA - Kargo destek hikayesi` scripti oluşturuldu. Kullanıcının eski scriptine test verisi yazılmadı.

Editör: http://localhost:5173/scripts/01a10c66-a79a-774e-b8a2-875bb22c5088/versions/1/edit

1. **01 · Kargo karşılama:** başlık TR `Kargo destek merkezi`, EN `Delivery support`. İleri düğmesi çözüm sayfasını açar.
2. **02 · Teslimat sorunu ve çözüm:** başlık TR `Teslimat sorunu ve çözüm`, EN `Delivery issue and resolution`. İleri düğmesi bitiş düğümüne gider.
3. `trackingReference` session string değişkeni, sentetik varsayılan `TEST-0001`; ses kanalı ve bu referansa göre uygunluk kuralı oluşturuldu. Kural tanımı burada yapılandırma örneğidir; sayfa geçişini koşullandırdığı iddia edilmez.
4. Akıştaki eski doğrudan bitiş bağlantısı kaldırıldı. Karşılama → çözüm → bitiş bağlandı, otomatik yerleşim kullanıldı. Önizlemede iki İleri düğmesine basıldı; zaman çizelgesinde `n-end` tamamlandı.
5. `QA - Kargo karşılama kontrolü` ve `QA - Kargo iki adım tam akış` senaryoları sentetik veri onayıyla kaydedildi. **Kayıtlı senaryoları çalıştır** düğmesi sunucuda ikisini de başarılı sonuçlandırdı. [Ekran kanıtı](evidence/scripting-story-20261005/kargo-regression-passed.png).
6. Editör tam ekranda ve tuvale sığdırılmış olarak bırakıldı. Sayfalar sekmesinden sayfa seçilebilir; Önizleme / debugger üzerinden yeniden denenebilir. [Son editör görünümü](evidence/scripting-story-20261005/kargo-editor-final.png).

Bu senaryo müşteri CRM/telefon sistemine veri göndermez. Dış komutlar önizleme simülasyonunda mock çalışır. Ayrı 45 senaryoluk matris gerçek yerel API ve veritabanını kullanır; yeni hikayede iki dil, iki adlandırılmış sayfa, değişken, kural ve kayıt sonrası yeniden yükleme UI ve veritabanı üzerinden kontrol edilir. Elle yapılan iki sayfalı akış bağlantısı bu otomatik hikaye testinin kapsamından ayrıdır.

## Bulunan ve düzeltilen sorunlar

| Sorun | Düzeltme | Regresyon kanıtı |
| --- | --- | --- |
| Yeni bileşene TR/EN metin yazarken UUID içindeki tireler üretilen i18n anahtarını geçersiz kılıyordu. Katalog kaydı gerçek component prop'una da bağlanmıyordu. | Şemaya uygun, çakışmasız noktalı anahtar; prop ve metin kataloğu tek geri alınabilir işlemde güncellenir. | `translations-before.log` başarısız, `translations-after.log` başarılı; gerçek UI, DB, yenileme ve runtime görünümü. |
| Seçim/clipboard uygun değilken işlem butonları açık görünüyordu. | Kopyala/yapıştır/çoğalt/sil/grupla/gruptan çıkar için seçim, parent, readonly ve clipboard kontrolü. Kopyalama UI yetenek durumunu günceller. | `toolbar-before.log` başarısız, `toolbar-after.log` başarılı; gerçek hikayede işlem dizisi. |
| Özellik panelinde içerikle ikincil ayarlar aynı yoğunlukta görünüyordu. | Kategoriye göre temel içerik alanları önce; ileri ayarlar klavyeyle açılan Gelişmiş özellikler bölümünde. Alanlar kaldırılmadı. | `inspector-layout-before.log` başarısız, `inspector-layout-after.log` başarılı; 72 bileşenin sekmeleri, üç tema görselleri. |
| Yeni sayfalar aynı genel adla kalıyordu, doğrudan ad düzenleme alanı yoktu. | Sayfa adı alanı, şema uzunluk sınırı, linked sayfalarda readonly; sayfa ID ve flow referansları değişmez. Panelde aralık ve uzun ad sarmalama. | `page-name-before.log` başarısız, `page-name-after.log` başarılı; undo ve readonly testi, gerçek API DB kalıcılığı. |

## Kontrol matrisi

| Alan | Denenen davranışlar | Kanıt türü |
| --- | --- | --- |
| Script yaşam döngüsü | Yeni script, ilk taslak, değişiklik notu, review/approval/publish öncesi regresyon kapısı, yayınlı sürümden taslak | Gerçek ürün matrisi + kontrollü tarayıcı suite |
| Ekran araçları | Ekle, sürükle, kopyala, yapıştır, çoğalt, sil, geri al, yinele, grupla, gruptan çıkar, klavye kısayolları | Birim, Chromium ve elle hikaye |
| Katmanlar | Klavye seçimi, collapse, additive selection, kardeş sırası, başka sayfada arama ve inspector'a gitme | Birim + Chromium |
| Sayfalar | Ekle, seç, adlandır, undo, readonly bağlı ekran koruması | Birim + gerçek kayıt ve yenileme |
| Inspector | TR/EN, boolean, enum, sayısal sınırlar, JSON son geçerli değer, responsive stil, override kaldırma, iki yönlü binding, olay ekleme/sıralama/silme, visibility rule | Birim davranış testleri; sekme erişimi 72 tür |
| Akış | Düğüm ekle, sürükle, otomatik düzenle, undo, karar/servis bağlantıları, referansları atomik rename, sayfa açma | Chromium suite; elle iki sayfa ve bitiş |
| Değişken/kural | Typed session değişkeni ve varsayılan JSON, kural ekleme/düzenleme, görsel condition builder, referans atama/kaldırma | Birim + gerçek hikaye |
| Önizleme/debugger | Runtime iframe, cihaz/tema/dil, pause/step/continue/restart, seçili zamana dönme, senaryo kaydı, sunucu regresyonu | Birim + Chromium + elle tamamlanan hikaye |
| Düzen/a11y | Üç tema, 320/768/1440 genişlik, yatay taşma, düğme çakışması, klavye/axe, tam ekranda durum korunması, sidebar küçültme ve tercih kalıcılığı | Chromium suite ve incelenmiş görseller |
| Kayıt/güvenlik | Autosave, CSRF, optimistic version, linked screen pins, readonly, yasak role/route, CSP/frame script engeli, preview hassas veri sınırı | Birim + Chromium + gerçek API matrisi |
| Ortak düzenleme | İki tarayıcı kullanıcısının karşılıklı güncellemeleri, beş tur mod değiştirerek convergence, flush ve DB kalıcılığı | Üç tam gerçek matris koşusu geçti; aşağıdaki risk açık |

### Bileşen bazında tarayıcı sonuçları

Her satır: UI'dan ekleme, Özellikler/Stil/Veri bağlama/Olaylar/Kurallar sekmesini seçme, katmanda bulunma, undo ve redo. Bu, her bileşenin tüm domain davranışlarıyla gerçek dış sistemde kullanıldığı anlamına gelmez.

| Bileşen türü | Kontrol sonucu |
| --- | --- |
| `button` | Geçti |
| `scriptText` | Geçti |
| `box` | Geçti |
| `webService` | Geçti |
| `privacyNotice` | Geçti |
| `explicitConsent` | Geçti |
| `objectionHandler` | Geçti |
| `callout` | Geçti |
| `checklist` | Geçti |
| `knowledgeLink` | Geçti |
| `text` | Geçti |
| `heading` | Geçti |
| `richContent` | Geçti |
| `alert` | Geçti |
| `textInput` | Geçti |
| `textArea` | Geçti |
| `numberInput` | Geçti |
| `currencyInput` | Geçti |
| `select` | Geçti |
| `multiSelect` | Geçti |
| `radioGroup` | Geçti |
| `checkboxGroup` | Geçti |
| `checkbox` | Geçti |
| `toggle` | Geçti |
| `datePicker` | Geçti |
| `timePicker` | Geçti |
| `rating` | Geçti |
| `slider` | Geçti |
| `phoneInput` | Geçti |
| `emailInput` | Geçti |
| `maskedInput` | Geçti |
| `addressInput` | Geçti |
| `tcknInput` | Geçti |
| `vknInput` | Geçti |
| `ibanInput` | Geçti |
| `creditCardInput` | Geçti |
| `section` | Geçti |
| `card` | Geçti |
| `columns` | Geçti |
| `tabs` | Geçti |
| `accordion` | Geçti |
| `stepper` | Geçti |
| `wizard` | Geçti |
| `modal` | Geçti |
| `divider` | Geçti |
| `spacer` | Geçti |
| `repeater` | Geçti |
| `lookup` | Geçti |
| `autoComplete` | Geçti |
| `dataGrid` | Geçti |
| `keyValueList` | Geçti |
| `customerCard` | Geçti |
| `timeline` | Geçti |
| `chart` | Geçti |
| `table` | Geçti |
| `actionButton` | Geçti |
| `nextButton` | Geçti |
| `backButton` | Geçti |
| `buttonGroup` | Geçti |
| `dispositionPicker` | Geçti |
| `outcomeSubmit` | Geçti |
| `transferHint` | Geçti |
| `callbackScheduler` | Geçti |
| `image` | Geçti |
| `video` | Geçti |
| `iframe` | Geçti |
| `timer` | Geçti |
| `countdown` | Geçti |
| `note` | Geçti |
| `badge` | Geçti |
| `progressIndicator` | Geçti |
| `signature` | Geçti |

## Test koşularının ayrıştırılması

- İlk tam Chromium koşusunda 188 test geçti, 10 görsel referans farklıydı. Farklar yeni disabled durumları ve inspector alan aralıklarıydı. Light/mobile, high contrast/desktop ve fullscreen actual/diff görüntüleri incelendi; 10 referans güncellendi. Screenshot fark toleransı ve axe kuralları değiştirilmedi. [İlk log](evidence/scripting-story-20261005/browser-final.log), [referans güncelleme](evidence/scripting-story-20261005/visual-update.log).
- Yanlışlıkla geliştirme sunucusunda çalıştırılan tam koşu 161 başarılı/37 başarısız oldu. Trace'de `/src/api/client.ts` modül isteğini testteki geniş `**/api/**` route taklidinin yakaladığı ve JSON döndürdüğü görüldü. Bu sonuç saklandı; ürün kabulü için derlenmiş uygulama ayrı 5473 preview portunda tekrar çalıştırıldı. [Yanlış ortam logu](evidence/scripting-story-20261005/browser-acceptance.log).
- İlk iki unit tam koşusunda async campaign tablo testi 1s varsayılan beklemede sonuçlanmadı; sayfa adı testi de uygulanmadan önce beklenen şekilde kırıldı. Campaign testi aynı dosyadaki diğer async route beklemeleri gibi 5s sınır kullanır. Beklenen görünüm ve veri assertion'ları korunur. Son tüm 334 test geçti. Bu bir ürün düzeltmesi olarak sayılmadı.

## Açık sınırlar ve rekabet hükmü

- Önceki kapsamlı denetimde ortak düzenleme iki tam koşuda başarısız olmuştu. Bu tur mevcut ilk 44/44, sonra üç 45/45 tam koşu başarılı; son koşularda beş karşılıklı güncelleme turu eklenmiştir. **Önceki aralıklı hatanın kök nedeni bulunmadı ve collaboration uygulamasına kök neden düzeltmesi yapılmadı.** Bu nedenle kesin release güvenilirliği onayı yok; başarısız eski kanıtlar korunur.
- Awaken demo üzerinde eşleşmiş görev/süre/hata ölçümü yapılmadı. Genel “Awaken'dan daha iyi” sonucu bu yerel testlerden çıkarılamaz. Önceki [kapsamlı karşılaştırma](AWAKEN_FULL_AUDIT_2026-10-05.md) geçerli sınırları korur.
- Canlı telefon sağlayıcısı, müşteri SSO/IdP, canlı AI/speech, CRM writeback, ödeme/kimlik verisiyle gerçek işlem, HA/DR ve yüksek yük bu turda doğrulanmadı.
- Bu rapor Chromium yerel kontrolüdür; bütün browser/OS kombinasyonları veya her olası form değeri için kabul değildir. Çözülememiş riskler test sayısıyla gizlenmez.

## Tekrarlanabilir son komutlar

```sh
pnpm --filter @verbis/designer-web test
pnpm --filter @verbis/designer-web typecheck
pnpm --filter @verbis/designer-web lint
pnpm --filter @verbis/i18n test
node --test scripts/final-audit.spec.mjs
pnpm exec tsc -p tests/verification/tsconfig.json
DESIGNER_ENVIRONMENT=dev pnpm --filter @verbis/designer-web build
# Ayrı terminal, apps/designer-web dizininden:
pnpm exec vite preview --port 5473 --strictPort
# Repo kökünden; üretim derlemesi üzerinde kontrollü E2E:
DESIGNER_WEB_PORT=5473 pnpm --filter @verbis/designer-web exec playwright test --project=chromium --workers=4
# Gerçek yerel API/DB matrisi; isolated test ortamı global setup ile hazırlanır:
PRODUCT_BROWSER_EVIDENCE=/absolute/path/evidence pnpm --filter @verbis/api exec vitest run --config ../../tests/verification/v2.config.mjs tests/verification/product-browser.audit.spec.ts
```

`DESIGNER_ENVIRONMENT=dev` yalnızca ortam etiketi/URL yapılandırmasıdır; `vite build` üretim derlemesidir. Son testin kaynağı, komut sonuçları ve görüntü hash'leri [manifest](evidence/scripting-story-20261005/manifest.json) içinde kayıtlıdır.
