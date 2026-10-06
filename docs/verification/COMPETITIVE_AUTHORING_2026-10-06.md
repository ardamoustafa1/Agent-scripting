# Awaken kıyası: authoring ve yayın güvenilirliği

Tarih: 2026-10-06. Bu tur beş somut yerel açık kapatıldı. Genel rekabet üstünlüğü veya enterprise satış/üretim kabulü sonucu değildir. Gerçek vendor, Awaken ve insan pilot erişimi kullanıcının önceki kararıyla ertelenmiştir.

## Dayanak ve değişiklikler

Awaken'ın resmi [Designer](https://docs.awaken.io/ag/core/designer.html) belgesi alan bulma ve sayfa aramayı; [Checking and Previewing Workflows](https://docs.awaken.io/ag/core/checking_and_previewing_workflows.html) yapısal kontrol ve temsilci önizlemesini açıklar. Bu belgeler rakibin işlev beyanıdır, aynı görevde hız veya kalite ölçümü değildir. Verbis'te bu temel kullanım açıklarını kapatmak üstünlük kanıtıyla karıştırılmaz.

1. Bileşen araması yalnız ham ID/prop yerine mevcut dilde görünen belge metnini, varsayılan dil fallback'ini, erişilebilirlik etiketini ve çevrilmiş tür adını bulur. Türkçe İ/ı ve diakritikler normalize edilir. Alakasız çeviri anahtarları bütün belgeye yayılmaz. Tek walkNodes dolaşımı kullanılır; arama belgeyi değiştirmez.
2. Sayfalar ad veya kimlikle filtrelenir; sonuç yok durumu ve temizleme/yeniden seçim çalışır. Bileşen sonuçları 50'şer sayfalanır: 1.000 eşleşmede bütün sonuçlar ulaşılabilir, DOM'a 1.000 düğme eklenmez. Bu sentetik kabul bütün büyük belgelerde latency garantisi değildir.
3. Regresyon yeniden başlatıldığında eski rapor temizlenir. Başarısız tekrar eski geçti sonucu üzerinden yayın düğmesini açamaz. Belge değişimi, kayıtlı belge revizyonu veya script/sürüm kimliği değişince kabul durumu sıfırlanır; eski async cevap unmount sonrası geri dönemez. Release number ile optimistic document revision ayrı tutulur (release2/revision7 kabul testi). Editörün üç mevcut başarılı save yolu revision state'ini günceller; lifecycle release ve preview aynı revizyonu geçirir. Liste satırında revision yoksa istemci uzak değişikliği anında bildiğini varsaymaz; sunucu yayın sırasında regresyonu yeniden çalıştıran mevcut bağımsız kapısını korur.
4. Seçili node olmadığında da taşan tuval Tab ile odaklanabilir ve native yön tuşuyla kaydırılabilir. Görünür token odak çerçevesi eklendi. Focusable scroll group için no-noninteractive-tabindex'in tek satırlık açıklamalı istisnası kullanıldı: group'u yanıltıcı button/application rolüne çevirmedik. Axe kontrolleri veya test toleransları gevşetilmedi.

5. Son görsel kontrolde lifecycle onay/emekli durumlarının küçük harfli API enum değerleri için çeviri eksikliği bulundu. Ekrandaki ham designer.workspace.status.approved anahtarı yerine TR/EN etiketi eklendi; tüm beş lifecycle state için önce başarısız katalog testi yazıldı. Yayın tarayıcı testi artık Approved görünümünü de doğrular.

## Regresyon ve kapsam

Önce yeni unit beklentilerinde çevrilmiş metin, sayfa arama ve eski rapor kullanımı başarısız oldu; ölçek testinde sonuç DOM'u sınırı aşıldı. İlk mobil browser matrisi scrollable-region-focusable ihlalini yakaladı ve kaynak düzeltildi. Test geliştirilirken eksik fixture izni, 1.000 box + button sayım beklentisi ve warning'in status rolü düzeltildi; ürün izinleri veya kontroller gevşetilmedi. Revision/report contract incelenerek report.version'ın release numarası olmadığı doğrulandı.

Yeni browser kapsamı TR/EN × light/dark/high-contrast ×320/1440, axe/global overflow, sayfa filtreleme ve aramada veri mutation olmaması; büyük sonuçlarda ikinci sayfa ve gerçek inspector seçimi; native ArrowRight scroll; başarılı/500/stale/başarılı regresyon ve yayın mutation olmamasını içerir. Fixture browser testi gerçek vendor bağlantısı değildir.

Canlı kullanıcı Chrome'unda mevcut Müşteri karşılama editöründe ILERI araması btn-next sonucunu buldu; seçimde TR İleri/EN Next özellikleri görüldü. Belge, atama veya yayın değiştirilmedi. Kanıt: artifacts/competitive-authoring-20261006/live-translated-search.png. Fixture screenshot'ları aynı dizindedir. Gerçek ürün harness ayrı test tenantı/DB/API/hub oturumları kullanır ve temizler; kullanıcı dev servisleri korunur.

## Son sonuçlar

Son koşu değerleri ve hash manifesti evidence/competitive-authoring-20261006/ dizininde saklanır. Aynı anda çalıştırılan ek unit koşusunda iki hata görüldü ve tamamlanmadan iptal edildi; bu koşu başarı sayılmaz. Daha önce bu tur önceki unit suite365/365 geçmişti. Son tekrar sonucu aşağıya ayrıca kaydedilir.

| Kontrol | Sonuç |
|---|---|
| Tam Designer Chromium (snapshot güncellemesi olmadan) |247/247, 4.9m |
| Son lifecycle çeviri düzeltmesinden sonra yeni browser matrisi |14/14, 21.1s |
| İzole gerçek API/hub/DB tam ürün Chromium |45/45, 187.89s |
| Nihai Designer unit, coverage açık, maxWorkers=1 |365/365, 50 dosya |
| İlk başarısız editor dosyasının bağımsız tekrar kontrolü |13/13 |
| i18n unit |8/8 |
| Designer/i18n lint, build, Prettier, git diff check |Geçti |

Son Designer coverage: statements89.68%, branches81.24%, functions87.57%, lines91.68%; mevcut eşikler korunur. Önceki ek iki tam unit koşusu eşzamanlı yük altında aynı iki editor kontrolünde başarısızlık gösterip tamamlanmadan durduruldu. Tek dosya ve worker sayısı1 ile tüm testler geçti; timeout veya assertion artırılmadı. Bu durum başlangıç hatalarının nedenini kesin kanıtlamaz; CI yükünde kararlılık ayrıca izlenmelidir. Mevcut ELK chunk boyutu uyarısı sürer. Son katalog düzeltmesinden sonra build +14 yeni browser testi tekrarlandı;247'lik koşu katalog düzeltmesinden öncedir. Firefox/WebKit bu tur yeniden çalıştırılmadı; önceki üç motor sonuçları önceki raporda tarihseldir.

## Açık kalan işler

[ROADMAP](../ROADMAP.md) enterprise kabul açıklarını izler. Özellikle KMS/Vault/HSM transit boundary ve key recovery; hub/document distributed owner fencing/failover; backup/PITR/WORM restore RPO/RTO tatbikatı; gerçek I/O ve timer continuation replay; hedef yük/topolojiye göre güvenlik ve performans kabulü bu tur tamamlanmadı. Bunlar yalnız hesap erişimi bekleyen işler değildir; ayrı mimari değişiklik ve operasyon kanıtı gerektirir.

Gerçek telefon lifecycle/outcome ACK, lisanslı Awaken'da eşit authoring/debugger görevi ve temsilci pilotu halen yapılmadı. [Ölçüm paketi](awaken-benchmark-20261005/EXECUTION_PACKET.md) hazırdır; rakip süre/hata/AHT hücreleri doldurulmaz. “Diğer gereken her şey tamam” veya “Awaken'ı geçtik” denemez. Mevcut güçlü farklılaşma adayları ortak düzenleme, sürüm/onay izlenebilirliği ve kaydedilmiş senaryo regresyonudur; bağımsız karşılaştırma hâlâ gereklidir.
