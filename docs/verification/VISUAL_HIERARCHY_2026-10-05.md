# Görsel hiyerarşi iyileştirmesi — 2026-10-05

## Tasarım kararı ve karşılaştırma sınırı

Awaken’ın resmi [Designer belgesi](https://docs.awaken.io/ag/core/designer.html) ve [yayınladığı editör ekranı](https://docs.awaken.io/ag/core/drex_designer_screen.png) tarayıcıda incelendi. Referansta koyu belge/komut alanı, kontrol paneli ve açık çalışma tuvali ayrılıyor. Verbis’te eksik görülen belge kimliği, aktif mod ve liste filtrelerinin ayrımı güçlendirildi. Bu görsel değerlendirme tasarım kararıdır; lisanslı güncel Awaken hesabıyla aynı görevde insan kullanılabilirlik ölçümü değildir. Genel üstünlük veya satışa hazır sertifikası olarak yorumlanamaz.

## Uygulanan değişiklikler

- Lacivert sidebar ve açık çalışma arka planı korundu. Koyu vurgu liste başlığı ve editör belge kimliğinde kullanıldı; tüm içerik koyulaştırılmadı.
- Script/kampanya/kaynak kitaplığı ortak başlığı marka renkleri, sayım rozeti ve belirgin oluşturma butonuyla düzenlendi. Filtreler ayrı yüzey, kenarlık ve dengeli boşluklarla toplandı.
- Tablo başlıkları, isim ikonları ve kolon ayırıcıları sadeleştirildi. İkinci genel tablo araması işlevi korunarak küçültüldü.
- Script detay kimliği ayrı kart; araç bağlantıları aynı yüzey ve hover vurgusunu kullanır.
- Editörde belge kimliği, aktif çalışma modu, özellik başlığı, bileşen kartları ve tuval araç satırı görsel olarak ayrıldı. Mevcut tam ekran/tuvale sığdır/zoom ve responsive yerleşim işlevleri korunur.
- Yeni renkler sabit CSS değerleriyle eklenmedi; mevcut marka, bilgi, yüzey, boşluk ve radius tokenları kullanıldı. Yeni UI metni veya backend/tenant değişikliği yok.

Kaynaklar: `apps/designer-web/src/workspace/visual-hierarchy.css`, `src/editor/editor.css`, `src/main.tsx`. Yeni regresyon: `apps/designer-web/e2e/visual-hierarchy.spec.ts`.

## Görsel inceleme

Canlı Chrome localhost:5173 üzerinde mevcut Müşteri karşılama taslağı ve script listesi açıldı; veri değiştirilmedi. Canlı görüntüler `artifacts/visual-hierarchy-20261005/live-editor.png` ve `live-library.png`.

Fixture test ekranlarında açık/koyu/yüksek kontrast, 320/768/1440 genişlikleri; script detay boş/dolu ve TR/EN; editör seçili bileşen ve mobil görünümü incelendi. Mobilde editör panelleri dikey sıralanır; sabit cihaz genişliğindeki tuval kendi çalışma alanında kaydırılabilir. Global yatay taşma kabul edilmez.

## Doğrulama

- Önce yeni kitaplık regresyonu eski şeffaf başlıkta beklenen biçimde başarısız oldu.
- Designer build ve lint başarılı. Mevcut ELK büyük bundle uyarısı sürer.
- Kitaplık + editör yerleşimi + script detay tasarım matrisi 29/29 başarılı; axe ve global overflow assertion’ları korunur.
- Editör işlevleri + welcome turu 99/99 başarılı. Amaçlı değişen görseller incelenerek referanslar yenilendi; screenshot toleransı değiştirilmedi.

İlk normal tam Chromium koşusu: 224 başarılı / 9 screenshot uyuşmazlığı. Uyuşmazlıklar analitik ekranının eski ortak shell referanslarında ortam rozeti ve sidebar profil düzenine aittir; bu tur analitik üretim kaynağı değiştirilmedi. Farklar görsel olarak incelendi, 19 analitik testi referans yenilemeyle başarılı oldu. Hiçbir assertion, axe kontrolü veya screenshot toleransı gevşetilmedi. Referans yenileme başarıları nihai normal tam koşunun yerine sayılmaz.

Nihai normal tam Chromium koşusu: **233/233 başarılı, 2.9 dakika**. `--update-snapshots` kullanılmadı. Yeni 9 kitaplık testi dahil; workspace formları, editör/palette/flow/rules/preview, script detay, lifecycle, regresyon/yayın kapıları, analitik, welcome turu ve performans senaryoları mevcut süitte çalıştı. Bunlar fixture tabanlı Designer testleridir; dış vendor/Awaken erişimi ve gerçek kullanıcı pilotu yerine geçmez. Yeni ve değişen kaynakların Prettier kontrolü ve `git diff --check` başarılı.

## Karşılaştırmada değerlendirilen görünür ölçütler

| Ölçüt | Verbis’te bu tur yapılan | Kanıt |
|---|---|---|
| Belge ve aktif mod ayrımı | Koyu belge kimliği, ayrı aktif mod vurgusu | Canlı editör PNG + editör screenshot testleri |
| Liste hiyerarşisi | Başlık/ana eylem, filtre paneli, kayıt tablosu ayrı katmanlar | Canlı liste PNG + 9 tema/genişlik testi |
| Küçük ekran uyumu | Başlık/CTA/filtreler dar genişliğe sığar | 320 ve 768 px overflow assertion’ları |
| Erişilebilirlik | Mevcut semantik/klavye yolları korunur, üç tema axe | E2E logları |
| Rakibe karşı hız/tercih üstünlüğü | Henüz ölçülmedi | Awaken hesabı ve aynı görevde kullanıcı ölçümü gerekir |

Kanıt logları: `docs/verification/evidence/visual-hierarchy-20261005/`; dosya bütünlüğü `SHA256SUMS`. Fixture görüntüleri gerçek müşteri/veri/üretim testi değildir; canlı görüntüler mevcut yerel dev ortamındandır.
