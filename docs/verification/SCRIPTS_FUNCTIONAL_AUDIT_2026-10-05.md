# Scriptler: tarayıcı işlev denetimi — 5 Ekim 2026

## Sonuç ve kapsam

Kullanıcının Chrome oturumunda `http://localhost:5173` üzerindeki Scriptler listesi, ayrıntı, ekran/akış/kurallar/değişkenler editörleri ve önizleme/debugger gezildi. Sentetik bir kargo destek hikâyesi oluşturuldu. Yedi bulgu düzeltildi; tekrarlanan alan kaydı düzeltmesine son değer doğrulaması da eklendi. Son gerçek sunucu regresyonu **4/4 başarılı**; son senaryo `vars.items` değerini de doğruladı.

Bu belge test edilen yolların kanıtıdır. Bütün özellik kombinasyonlarının hatasızlığı, dünyadaki en iyi ürün olma, Awaken üstünlüğü veya büyük kurumsal üretim kabulü sonucunu çıkarmak için yeterli değildir. Awaken üzerinde eşdeğer ölçümlü karşılaştırma bu çalışmada yapılmadı.

## Test verisi ve koruma

- Yeni sentetik script: **QA - Scriptler işlev testi**, `01a10d32-1808-730e-a1be-51ee68f6fa01`, v1 taslak.
- Hikâye: QA kargo başlığı → iki kargo satırı → ilk satırın adını değiştir → ikinci satırı koru → İleri ile akışı bitir. `qaTracking="TEST-0001"`; `items` iki sentetik satır içerir. Gerçek müşteri bilgisi kullanılmadı.
- Dört kayıt: temel akış, İleri ile tamamlanan akış, iki satır etkileşimi, kargo değerini doğrulama. Son kayıt önceki üç kayda ek olarak değişken sonucunu denetler.
- `arda`, `Müşteri karşılama` ve önceki QA hikâyesi değiştirilmedi. Yayın, kampanya ataması, secret veya inceleme bildirimi yapılmadı.
- Bileşen ekleme/silme denemeleri yeni QA taslağında geri alınabilir editör işlemleriydi. Kalıcı silme yapılmadı.

## Gerçek tarayıcıda yapılan işlemler

| Alan | Denenen işlemler ve gözlenen sonuç |
| --- | --- |
| Liste | Üst arama ve tablo içi aramada `MÜŞTERİ`; sonuçsuz sorgu/temizleme; taslak/sahip filtreleri; liste/kart görünümü; beş sıralama düğmesi; kolonun klavye ile boyutlandırılması ve sıfırlama; tüm satırlar/sanal liste |
| Oluşturma | Boş ve yalnız boşluk içeren adda buton devre dışı; geçerli ad ve açıklama ile script oluşturma; ilk taslak açma |
| Ekran | Başlık ekleme, TR/EN metin, otomatik kayıt ve yeniden açma; çoğaltma, geri al/yinele, kopyala/yapıştır, silme, çoklu seçim/gruplama/gruptan çıkarma; tam ekran aç/kapat |
| Palet | **72 bileşenin ekleme düğmesine tek tek basıldı**, Inspector açıldı ve ekleme geri alındı. Açık rıza ve tekrarlanan alan hataları tekrar üretildi ve düzeltildikten sonra yeniden denendi. Bu işlem her bileşenin bütün alan/olay seçeneklerini denemek anlamına gelmez. |
| Akış | Başlangıç, sayfa, karar, değişken atama, aktarım bilgisi, bitiş ve yorum düğümleri tek tek eklendi/geri alındı; otomatik yerleşim, yakınlaştırma, uzaklaştırma, sığdırma. Eksik bağlantı uyarıları gözlendi. Yapılandırılmamış veri kaynağı/alt akış işlemleri devre dışıydı. |
| Kurallar/değişkenler | `qaTracking` oluşturma; yanlış JSON'un reddi, geçerli değer kaydı; ses kanalı ve takip değişkeni koşullarını birleştirme |
| Önizleme | Duraklat/adım/devam; İleri, son sayfa ve bitiş; sentetik onayla senaryo kaydı; iki kargo satırında ilk alanı değiştirip ikinciyi koruma; debugger sekmeleri ve sunucu regresyonu |
| Sürüm/inceleme | Yayınlar/değişkenler sekmeleri; regresyon penceresi; inceleme ekranı ve beş karşılaştırma sekmesi; boş değişiklik notunda gönderme devre dışı |
| Atama/taşıma | Atama sayfası, boş kayıt koruması; kampanya çözümleme, yanlış JSON reddi ve etkin olmayan kampanyada `no_match`; taşımada uygun yayımlanmış sürüm bulunmadığından export devre dışı |

Etiket filtresinde yalnız “tüm etiketler” seçeneği vardı; etiketli gerçek veriyle diğer seçenekler doğrulanmadı. Sıralama düğmelerinin çalışması gözlendi; aynı durum/tarih değerleri bütün kolonların farklı veriyle sıralama doğruluğunu tek başına kanıtlamaz. Ortak düzenleme, gerçek onay/yayın, imzalı paket taşıma ve bütün rol kombinasyonları bu gerçek oturumda çalıştırılmadı. Dış entegrasyon ve canlı AI kapsam dışında tutuldu.

## Düzeltmeler ve regresyonlar

1. **Türkçe tablo araması:** `MÜŞTERİ` tablo içi aramada sıfır sonuç veriyordu. Dilin yerel küçük harf dönüşümü kullanıldı; `Müşteri` ve `Çağrı` için regresyon eklendi. Üst arama ile davranış tutarlı.
2. **Geri al/yinele/silme sonrası boş tuval:** veri duruyor fakat Chromium inert alt ağacında görünür boyut sıfıra düşüyordu. Doküman revizyonunda inert konak yeniden oluşturuluyor; sürükleme/zoom sırasında aynı konak korunuyor. Görünür başlık ve pozitif yüksekliği kontrol eden tarayıcı testi eklendi; silme de kapsandı.
3. **Tamamlanan etkileşimden sonra senaryo kaydı:** bildirim executor'un busy temizliğinden önce geliyordu. Bildirim bir sonraki görevde gönderiliyor. İleri sonrası kayıt düğmesinin etkinliği tarayıcıda ve regresyonda doğrulandı.
4. **Açık rıza varsayılanı:** gerekli TR/EN etiketleri dokümanda bulunmadığından yeni bileşen doğrulamayı bozuyordu. Eksik etiketler mevcut metinleri değiştirmeden ekleniyor. Onay kutusu seçili başlamıyor; ekleme ve hazırlık tek undo işlemi.
5. **Tekrarlanan alan varsayılanı:** `items` array değişkeni yoksa bileşen görüntülenemiyordu. Güvenli array hazırlanıyor; aynı isimde başka tip varsa üzerine yazılmadan benzersiz isim kullanılıyor. PCI array kullanımı engellenmeye devam ediyor. Hazırlık undo ile geri dönüyor.
6. **Yeniden girişte yanlış kayıt çakışması:** önbellekteki doküman/ETag ile editör başlıyor, güncel sunucu revizyonu Store'a yansımıyordu. Editör güncel GET tamamlanınca açılıyor. GET rev7 sonrasında PUT `If-Match: "7"` testi ve liste → ayrıntı → editör tarayıcı regresyonu eklendi.
7. **Tekrarlanan satırın senaryo kaydı:** satır değişkeni kayda alınmıyor ve benzersiz DOM kimliği doküman olay kimliği yerine yazılıyordu; kaydetme başarısızdı. DOM kimlikleri benzersiz kalırken kayıt orijinal doküman kimliğini kullanıyor; array değişimi olaydan önce kaydediliyor. İç içe çocuklara kaynak kimliği aktarılıyor. Kaydedilen sentetik değişkenlerin son değerleri artık beklenen sonuçlara ekleniyor. İki satırın korunması ve kaydın runtime ile tekrar oynatılması test edildi; gerçek sunucuda `vars.items` başarılı.

Her davranış düzeltmesi önce başarısız regresyonla gösterildi. Test sürücüsündeki yanlış rota/şema kimliği ve lint sorunları düzeltildi; bunlar ürün hatası sayısına eklenmedi. Çalışma sırasında yoğun eşzamanlı testte bir 5 saniyelik test zaman aşımı görüldü; süre sınırı artırılmadı. Değişiklik sırasında başlayan ara suite sonuçları son doğrulama yerine kullanılmadı.

## Kanıtlar

### Son test sonuçları

| Kontrol | Sonuç |
| --- | --- |
| Designer unit/coverage | **348/348**, 49 dosya |
| UI unit/coverage | **107/107**, 12 dosya |
| Components unit/coverage | **295/295**, 11 dosya |
| Core runtime unit/coverage | **124/124**, 11 dosya |
| Tam normal Chromium | **222/222**, 3.1 dakika; 72 palet bileşeni, beş Inspector sekmesi, undo/redo; lifecycle ve workspace form/theme/responsive kontrolleri dahil |
| Son değer kaydı regresyonu | Önce 1 başarısız/3 başarılı; düzeltmeden sonra 4/4 ve son tam Designer suite içinde başarılı |
| Lint/typecheck | UI, core-runtime, components ve Designer başarılı |
| Build | Core runtime, components, UI ve son Designer production build başarılı |
| Gerçek sunucu senaryoları | **4/4**, `vars.items` doğrulaması dahil |

Son değer assertion değişikliği tam Chromium taraması başladıktan sonra yapıldı; bu küçük kaydetme değişikliği son tam unit suite ve gerçek sunucu kaydet/tekrar oynat akışıyla doğrulandı. Chromium sayısı ayrı fixture/mocked API taramasıdır; gerçek sunucu 4/4 sonucu ayrı gösterilir. Sayılar önceki ve tekrarlanan koşuların toplamı değildir.

Tekrar çalıştırma: ilgili paketlerde `pnpm --filter @verbis/designer-web test` (ve UI/components/core-runtime eşdeğerleri), `lint`, `typecheck`, `build`. Chromium için development build/preview üzerinde `DESIGNER_WEB_PORT=5473 pnpm --filter @verbis/designer-web exec playwright test --project=chromium --workers=2`. Görsel referanslar bu işlev denetiminde değiştirilmedi.

`artifacts/scripts-function-audit/` içindeki ekran görüntüleri ve `palette-72-before.json`, `flow-actions.json` gerçek tarayıcı denemelerindendir. Palet JSON'u **düzeltme öncesi** durumu da içerir; bütün satırları “başarılı” göstermek amacıyla değiştirilmedi. Nihai test logları `docs/verification/evidence/scripts-function-20261005/` altında saklanır. `manifest.sha256` kaynak ve kanıtları ilişkilendirir.

Son sunucu regresyonu: **4/4**, `2026-10-05T18:34:44.630Z`, checksum `b1a56a1f59dac908975a32b1631bb88f8a31cfe4a4ac462b28eb64b47e4427a3`. `final-regression-dialog.jpg` bu sonucu ve `vars.items` assertion'ını gösterir.

Üretim derlemesi ELK/bundle boyutu uyarısı verir. Bu çalışma kapasite, SSO/kurumsal dağıtım, felaket kurtarma veya staging kabul testinin yerine geçmez. Mevcut görsel toleranslar, axe kontrolleri, hassas veri ve yayın/yetki korumaları gevşetilmedi.
