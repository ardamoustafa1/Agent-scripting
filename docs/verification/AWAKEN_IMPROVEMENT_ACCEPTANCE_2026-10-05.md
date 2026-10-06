# Awaken öncelik planı — uygulama ve kanıt

Kullanıcı gerçek telefon platformu, Awaken hesabı ve pilot katılımcılarını daha sonra sağlayacağını belirtti. Bu tur erişimden bağımsız ortak düzenleme düzeltmesi, eşit görev fixture'ı ve uygulanabilir ölçüm paketi tamamlanır. Genel ürün üstünlüğü veya enterprise üretim kabulü bu raporun sonucu değildir.

## 1. Tekrarlanan ortak düzenleme hatası

Önceki taze tam ürün sonucu 44/45 idi. Hedefli tekrar aynı ilk peer açıklama adımında başarısız oldu. İki kullanıcı/iki Yjs belge unit testinde alanlar birleşiyordu; gerçek browser tanısında peer metin değişikliği için yerel edit callback'i hiç çalışmıyordu. Tanı ayrıca aktif odağın açık `role=option` öğesinde kaldığını gösterdi: hızlı fare seçimi Radix'in açılış pointer-up korumasına takılıyor, menü kapanmıyor ve odak kapanı sonraki metin girişini engelliyordu. Bu bulgu CRDT veri birleştirme hatası veya kalıcı DB veri kaybı olarak sunulmaz.

Değişiklik: tasarım sisteminin Select bileşeninde birincil fare seçimi pointer-down sırasında tamamlanır ve kontrollü menü kapanır; touch/klavye Radix yolunu kullanır; disabled öğe seçilemez. İlk click fallback yeterince tutarlı değildi ve tekrarda elendi. Son düzeltme gerçek kaynak ve derlenmiş UI paketiyle sınandı. Diagnostik konsol çıktıları kaldırıldı. İş yetkisi, veri doğrulama, lease, audit veya convergence süresi gevşetilmedi.

Regresyon kapsamı:

- UI: açılış pointer-up'ı iptal edilse bile fare seçimi tamamlanır, menü kapanır ve odak trigger'a döner; mevcut klavye Space/ok/Enter yolu da geçer.
- Unit: boş ortak belgeye eklenen kuralın açıklaması iki store/Yjs peer arasında iki yönde birleşir.
- Gerçek browser/API/Postgres/Redis: iki ayrı BFF kullanıcı oturumu; beş tur panel değiştirme ve karşılıklı açıklama düzenleme; sunucunun gerçek WebSocket'lerine `terminate()` ile transport kesintisi; aynı istemcilerin yeni socket/ticket ile otomatik bağlanması; tekrar karşılıklı değişiklik; peer sayfası reload ve odaya tekrar katılma; save/close, DB üzerinden reload ve beklenen son açıklama.
- Güçlendirilmiş kesinti adımı `Saving changes` görünürken socket'leri keser; yeniden bağlandıktan sonra iki peer'ın son açıklamayı koruduğunu doğrular. Yazma askısı mevcut lifecycle unit testinde ayrıca sınanır. Kesintide UI'yi yeniden yükleyerek otomatik reconnect taklit edilmez.
- Her convergence kontrolünde önceki 5 saniye korunur. Son hedefli kontrolün 44 atlanan vakası, tam suite 45 başarıyla karıştırılmaz.

## 2. Eşit scripting görevi ve üç hata

`tests/verification/scripting-benchmark.ts` referans scripti ve sentetik senaryoları üretir. Tam beş sayfa, üç koşullu dal, iki veri kaynağı, okunması zorunlu metin ve outcome kaydı. İki dilde üçer yol; status/resolution/receipt, final outcome ve end durumu gerçek runtime/flow/action/validation motorundan doğrulanır. Zorunlu metin okunmadığında sayfa değişimi engellenir.

Üç bağımsız kasıtlı hata: yanlış koşullu dal hedefi, yanlış datasource variable eşlemesi ve mustRead kaldırılması. Testler yalnızca `false` sonucu beklemez: yanlış dalda `VERBIS_PREVIEW_EVENT_UNAVAILABLE`, eşlemede `vars.parcelStatus` assertion'ı ve uyumda `page` assertion'ı doğrulanır. Referans düzeltmeye dönünce aynı kontrol geçer. Fixture JSON, senaryolar, üç bozuk kopya ve results.json ayrı dışa aktarılır.

Bu **mock-only runtime doğrulamasıdır**: gerçek HTTP/vendor çağrısı, insan authoring süresi veya debugger'da insan teşhis süresi ölçümü değildir. İki locale senaryosu runtime context'ini kapsar; burada altı yeni ekran render/a11y kontrolü yapıldığı iddia edilmez. Üç hata testlerde tespit edildi diye Awaken'dan daha hızlı bulunacağı sonucu çıkarılmaz.

## 3. Erişim bekleyen işler hazırlandı

[Uygulama paketi](awaken-benchmark-20261005/EXECUTION_PACKET.md): iki ürüne aynı görev, dengelenmiş görev sırası, eşit eğitim/cihaz/veri sözleşmesi, yedi kabul, hataların bağımsız kopyalarda gizli uygulanması, süre/hata/yardım ölçüm şablonları.

- Gerçek platform: incoming/hold/resume/transfer/kopma/reconnect/outcome-not geri dönüşü, retry/idempotency ve izin reddi için kabul ve correlationId/ACK/platform ekranı kanıtları tanımlandı. Gerçek platform çalıştırılmadı; önceki yerel simülatör kabulü yerine sayılmaz.
- Awaken: mevcut hesaba giriş ve aynı görevin o ürünün yerel araçlarıyla yapılması bekleniyor; JSON import desteği varsayılmıyor. Rakip ölçüm satırları doldurulmadı.
- Pilot: eğitim ve dengeli senaryolar, AHT bileşenleri, operasyon hatası pay/payda, zorunlu metin ihlali ve veri kaybı/tekrar ayrı tutulur. Başlangıç katılımcı önerisi istatistiksel üstünlük garantisi değildir. İnsan ölçümleri doldurulmadı.

## 4. Son kontrol sonuçları ve kanıt

Son loglar ve SHA-256 manifest: `docs/verification/evidence/awaken-improvement-20261005/`. Sentetik runtime paketi ve browser screenshot'ları: `artifacts/awaken-improvement-20261005/`. Testcontainers, test tenantları ve geçici Vite süreçleri harness cleanup ile kapatılır. Shared dev tenantı, canlı atamalar ve kullanıcı 5173/5174/5175/4000 servisleri değiştirilmez.

| Son kontrol | Sonuç |
|---|---|
| Gerçek tam ürün matrisi — Chromium | 45/45, 96.89s |
| Gerçek tam ürün matrisi — Firefox | 45/45, 175.15s |
| Gerçek tam ürün matrisi — WebKit | 45/45, 152.15s |
| Chromium ek pending-write transport kesintisi + save/reopen | 1/1; 44 kapsam dışı vaka atlandı |
| Designer unit | 352/352, 49 dosya |
| UI unit | 107/107, 12 dosya |
| UI fare/klavye browser regresyonu | 2/2 |
| Sentetik scripting benchmark | 11/11 (6 dal/dil + 1 zorunlu metin + 3 hata/onarım + 1 export) |
| UI lint/typecheck/build; Designer lint/build/types | Geçti |
| Verification harness lint/types/format; diff whitespace | Geçti |

Chromium tam koşusunda aynı transport kesintisi vardı; pending badge ve reconnect sonrası eski değerin korunması assertion'ları ayrıca hedefli Chromium koşusunda ve iki diğer motorun tam koşularında doğrulandı. Başarılar tekrar koşular eklenerek şişirilmez: tam ürün matrisi toplam **135 tarayıcı vakasıdır**. Çalışma süreleri eşzamanlı QA yükü altındaki suite süreleridir, authoring/AHT/performans kıyası değildir. Designer build'deki mevcut büyük ELK chunk uyarısı sürer.

[Kaydedip tekrar açılan peer değişikliği](../../artifacts/awaken-improvement-20261005/collaboration-proof/collaboration-saved-reopened.png). Popup kapanışı beklenerek screenshot alınır. Tarihsel 44/45 raporu silinmez; bu rapor son kanıtı ayrı tutar.

Karar: yerel ortak düzenleme kabulündeki tekrarlanan hata bu kapsamda kapatıldı. Lisanslı vendor lifecycle, Awaken'da eşit insan görevi, debugger süre kıyası ve temsilci pilotu **erişim/katılımcı bekliyor**. Production staging/HA/DR kabulü ayrı kalır.
