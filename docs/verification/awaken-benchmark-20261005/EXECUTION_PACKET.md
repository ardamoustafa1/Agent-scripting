# Verbis / Awaken eşit görev ve temsilci pilotu

Durum: uygulama paketi hazır; Awaken hesabı, gerçek telefon test ortamı ve insan katılımcılar kullanıcı tarafından daha sonraya bırakıldı. Bu dosya sonuç raporu değildir. Otomatik runtime süresi, insanın tasarım veya hata bulma süresi yerine kullanılamaz.

## Ortak görev — iki ürün için aynı gereksinimler

Sentetik kargo destek scripti: tam beş sayfa (karşılama, kargo takibi, adres değişikliği, uzman desteği, sonuç); talep türüne göre üç koşullu dal; iki veri kaynağı; okunması onaylanmadan geçilemeyen zorunlu metin; kalıcı sonuç kaydı. Türkçe ve İngilizce. Kargo kodu SYNTHETIC-001; lookup yanıtı status=IN_TRANSIT; kayıt yanıtı receipt=SYNTHETIC-RECEIPT. Her dalın sonuç kodu tracking/address/escalation; final outcome BENCHMARK_DONE. Verbis JSON bir referans çözümdür; Awaken JSON import desteği varsayılmaz, orada aynı görev yerel araçlarla yapılır.

1. Her üründe boş proje, aynı izinler ve temiz test tenantı açılır. Kullanıcıya sadece bu görev ve sentetik veri sözleşmesi verilir. Tamamlanmış referans çözüm önceden gösterilmez.
2. Eğitim için aynı süre ve aynı seviyede ürün tanıtımı sağlanır; kişinin önceki ürün deneyimi kaydedilir. Ürün sırası katılımcılar arasında dengelenir; ikinci görevde eşdeğer veri adları kullanılarak ezber etkisi azaltılır.
3. Sayaç görevin gösterilmesiyle başlar; aynı yedi kabul (üç dal × iki dil + okunmamış zorunlu metnin engellenmesi) bağımsız gözlemci tarafından geçtiğinde biter. Yardım talepleri, yanlış yayın girişimleri, bozuk eşleme, yanlış dal, düzeltme ve eğitim süreleri ayrı tutulur. Bitmeyen görevler başarısız olarak kalır, süre ortalamasından sessizce çıkarılmaz.
4. Beklenen iz: welcome → seçilen dal → summary → end. İki veri kaynağı başarıyla çalışır; parcelStatus, resolution, receipt beklenen değerlere eşittir; sonuç yalnızca başarılı kayıt sonrasında gönderilir. Okunmamış metinde welcome terk edilemez.
5. Aynı cihaz/tarayıcı/ağ, benzer ürün sürümü, aynı veri kaynağı gecikmesi ve eşit erişim düzeyi kullanılır. İki ürün için çalışma kaydı ve görev çıktısı kanıt olarak tutulur; sentetik veriler dışında kişisel bilgi kaydedilmez.

## Debugger görevi — aynı üç kasıtlı hata

Görev başlamadan evaluator referans çözümün ayrı kopyasına yalnızca bir hata ekler. Katılımcıya hata türü ve yeri açıklanmaz. Hatalar rastgele sırada, ayrı temiz kopyalarda verilir.

| Hata | Kasıtlı değişiklik | Başarı kanıtı |
|---|---|---|
| Koşullu dal | tracking dalı address sayfasına gider | Doğru sayfa izine dönmesi; iki dil dahil tüm kabulün tekrar geçmesi |
| Veri eşleme | lookup status çıktısı parcelStatus yerine receipt'e yazılır | parcelStatus=IN_TRANSIT, receipt=SYNTHETIC-RECEIPT; iki kaynağın doğru sırası |
| Uyum | mustRead zorunluluğu kaldırılır | Okunmamış metnin welcome sayfasından çıkışı engellemesi |

Hata bulma süresi, düzeltme süresi, yanlış teşhis ve yardım sayısı ayrı ölçülür. Verbis'te otomatik senaryonun hatayı yakalaması, Awaken'da insanın daha yavaş olacağına kanıt değildir. Rakibin kendi Check/Preview/debug araçlarını kullanması serbesttir.

## Telefon platformu kabulü — erişim geldiğinde

Üretim yerine lisanslı sandbox; iki test temsilcisi ve yalnızca sentetik aramalar. Platform adı/sürümü, sandbox URL, kampanya/queue eşlemesi ve beklenen callback sözleşmesi gerekir. Parolalar rapora konmaz; bağlantı yönetimi ve secret store kullanılır.

| Adım | Kabul ve kanıt |
|---|---|
| Gelen çağrı | Güvenli launch, doğru script sürümü/temsilci, ikinci kullanıcıda erişim reddi |
| Hold/resume | Platform olayı ve runtime durumunun aynı interaction için tutarlı olması |
| Transfer | Kaynak/hedef temsilcide doğru devir; önceki temsilcinin yazma yetkisinin kalkması |
| Kopma | Platform/ağ kesintisinde görünür durum; sessiz sonuç kaybı veya tekrar yok |
| Yeniden bağlanma | Aynı interaction'ın devamı; eski olayların yeni çağrıya taşınmaması |
| Outcome/not | Kalıcı outbox kaydı, gerçek platform ACK, platform ekranında doğru sonuç/not |
| Retry | Tekrarlanan olay/ACK ile yinelenen outcome/not oluşmaması; idempotency kanıtı |
| İzin reddi | Platform hata kodu, kullanıcı geri bildirimi, retry/kalıcı hata ayrımı |

Her adım timestamp/correlationId ile API, hub ve vendor kanıtlarını bağlar. Yerel simülatör geçişi gerçek vendor kabulü sayılmaz.

## Temsilci pilotu

Önce sentetik çağrılarla eğitim ve görev anlaşılabilirliği; ardından kurumun izin verdiği kontrollü pilot. Başlangıç hedefi 8–12 temsilci ve her üründe kişi başına en az 20 dengeli senaryodur; bu örneklem dünya geneli üstünlük iddiası için yeterli varsayılmaz. Deneyim seviyesine ve senaryo güçlüğüne göre dengeleme yapılır. Gerçek müşteri verisi kullanılacaksa kurumun kayıt/veri politikası uygulanır.

- İşlem hatası: yanlış dal, yanlış sonuç, eksik alan, yinelenen kayıt; hatalı görev / tamamlanan görev, pay/payda birlikte.
- Eğitim süresi: tüm kabul görevlerini yardımsız tamamlayana kadar geçen eğitim dakikası.
- AHT: konuşma + bekletme + çağrı sonrası iş süresi; ortalama, medyan ve p95. Otomatik testin çalışma süresi AHT değildir.
- Uyum: zorunlu metin atlama ve başarısız kayıtla tamamlanan çağrı; kritik ihlal sayısı ayrıca.
- Kullanılabilirlik: yardım sayısı, terk edilen görev, temsilci değerlendirmesi; teknik gecikmeler ayrı tutulur.

Önceden belirlenen karar: Verbis kritik uyum/veri kaybı hatası üretmemeli; diğer göstergelerde üstünlük iddiası yalnızca ölçülen görev/popülasyon için, belirsizlik aralıkları ve ham sayılarla yapılır. AHT iyileşirken hata veya uyum kötüleşirse kazanç kabul edilmez. Kurumsal satış için ayrıca staging güvenliği, kapasite, yedekten dönüş, HA ve operasyon kabulü gerekir.

## Dosyalar

- `artifacts/awaken-improvement-20261005/benchmark/`: script.json, scenarios.json, mandatory-gate.json, üç fault JSON ve otomatik results.json.
- Aynı klasöre sonuç koymadan `task-measurements.csv`, `debugger-measurements.csv`, `pilot-measurements.csv` doldurulur. Boş alan başarısız veya sıfır kabul edilmez.
- İki üründe insanlı ölçümler henüz yok; CSV dosyaları başlık şablonudur.
