# Designer önizleme ve hata ayıklama

Editörde **Önizleme / debugger** modunu seçin. Bu ekran aynı core-runtime renderer, aksiyon yürütücüsü, akış ve doğrulama motorunu kullanır. Dış platform komutları simüle edilir.

- **Ajan masaüstü görünümü (varsayılan):** script, ajan masaüstünün çerçevesi içinde gösterilir: üstte "Adım N", sayfa başlığı ve geçilen adımlar; altta Geri, "X / Y sayfa" ilerlemesi ve İleri; yanda zorunlu bildirimlerin canlı listesi. Parçalar ajan masaüstüyle aynı ortak bileşenlerdir (`@verbis/components` `agent-shell`), bu yüzden tasarımcının gördüğü ekran ajanın gördüğüyle aynıdır. Önizleme sahnesinin üstündeki "Ajan masaüstü / Yalnız script" seçimiyle çıplak sayfaya dönülebilir; editördeki canlı ajan görünümü her zaman çerçevelidir. İleri düğmesi ajan masaüstündeki gibi önce sayfayı doğrular; geçilemeyen adım çerçevede "İşlem tamamlanamadı" olarak, nedeni zaman çizelgesinde görünür.
- Cihaz genişliği/yüksekliği gerçek iframe viewport'unu değiştirir. Light/dark/high-contrast tema ve TR/EN seçimi çalışma alanından bağımsızdır; dil değişimi oturumu yeniden başlatır. Seçilen tema çerçevenin kök belgesine de uygulanır; kısa sayfaların altı işletim sisteminin koyu temasına düşmez.
- Etkileşim panelinde kanal, ANI, **ajan adı**, kampanya, attached data ve müşteri profilini düzenleyin. Ajan adı sentetik bir adla başlar (`agent.firstName`; ajan adı vermeyen kayıtlı senaryo yüklendiğinde de korunur); gerçek görüşmede oturum açan ajanın adı gelir, böylece "ben {agent}" gibi karşılamalar önizlemede de okunur. Başlangıç değişkenleri/agent/const dahil tüm bağlam JSON olarak düzenlenebilir. Değişiklikleri uygulamak için **Yeniden başlat** seçin.
- Veri kaynaklarında başarı/boş/hata/gecikme mock'u ve script çıktıları tanımlanır. Bir değişkene bağlı çıktı o değişkenin türündeki alanla düzenlenir; bağlı olmayan çıktıda yazılan biçim türü belirler: `720` sayı, `true`/`false` evet/hayır, baştaki sıfırlı değerler (`00123`) metin, tırnak içi (`"720"`) metin. Böylece `ds.creditScore.score ≥ 650` gibi koşullar gerçek servisteki gibi çalışır. Canlı çağrı için Integration execute yetkisi, kaydedilmiş script ve veri kaynağında açık test profili gerekir. Sürüm pin'i veya yetki uyuşmazlığında sunucu reddeder; prod'a düşmez.
- Duraklat/devam/bir adım aksiyon kontrolüdür. Breakpoint'ler sayfa girişine, aksiyon tipine veya zaman çizelgesindeki tam aksiyon yoluna atanabilir. Değişkenler türlerine göre alanla düzenlenir (metin, sayı, evet/hayır, tarih, seçenek listesi); yalnız liste ve nesne değişkenleri JSON alanında kalır. Aynı değişkene arka arkaya yazılan değerler (her tuş vuruşu) kayıtlı senaryoda tek adımdır; araya başka bir olay girerse ayrı adım olur. Hassas değerler maskelenir, global değerler salt okunurdur ve sözcükle gösterilir. Zaman çizelgesi ve lint bulguları aksiyon, bileşen ve sayfa adlarıyla okunur.
- Akış gezilen düğüm ve kenarları işaretler. Zaman çizelgesi session event'lerini, veri kaynağı çağrılarını, güvenli hata kodlarını ve süreleri gösterir. Son 100 durum geri yüklenebilir; toplam 1.000 olay tutulur. Veriler tarayıcı depolamasına veya analitik servise yazılmaz.
- **Bu ana dön**, eski çalışma ve çağrıları iptal eder. Değişkenler, sayfa ve akış konumu geri gelir; bekleyen aksiyon devamları, I/O ve zamanlayıcılar otomatik tekrar edilmez. Yeni etkileşimlerle devam edebilirsiniz; yeni bir senaryo kaydı için yeniden başlatın.
- Lint tüm model hatalarına ek olarak anlamlı label eksikliği, sıfır debounce, Submit öncesi doğrulama ve önceden işaretli zorunlu okuma onayını uyarır. Zorunlu okuma runtime doğrulaması tarafından ayrıca uygulanır.

## Senaryolar ve onay

**Senaryo kaydet** başlangıç bağlamını, mock'ları, değişken girdilerini, component olaylarını ve beklenen sayfa/end/outcome durumunu taslağa ekler; mevcut optimistic autosave ve audit yolu üzerinden kaydeder. Yalnızca sentetik veriyi onaylayın. Canlı çağrı kullanılan, hassas değişken kaydı içeren, işlem sürerken veya geri yüklenmiş bir oturum saklanamaz. Model JSON'undaki `expected.variables` ile ek değer assertions tanımlanabilir.

Senaryoları yüklemek başlangıç bağlamını ve mock'ları yeniden kurar; kaydedilmiş adımların otomatik replay'i **Kayıtlı senaryoları çalıştır** ile sunucuda yapılır. Releases sayfasındaki her sürümün regresyon/onay paneli raporu checksum ile gösterir. Onay/yayın aynı kontrolleri sunucuda yeniden çalıştırır; başarısızlık durumunda sürüm ilerlemez. Senaryosu olmayan eski sürümler mevcut onay politikalarını sürdürür. Plugin'lerin sunucu registry'sinde desteklenmeyen pin'leri başarılı kabul edilmez.

## API

- `POST /v1/scripts/:id/versions/:number/regression` — kayıtlı sürümün mock regresyon raporu; script scope yetkisi, CSRF ve audit.
- `POST /v1/scripts/:id/versions/:number/preview/data-sources/:source` — `{ input, environment: "test" }`; kayıtlı pin'e göre yetkili test çağrısı, secret-scrubbed değer ve süre, response replay yok.
- Mevcut document PUT taslak senaryolarını saklar. Mevcut reviews/publish POST işlemleri regresyon geçişini zorunlu kılar. Yeni veritabanı migrasyonu gerekmez.

## Önizleme güvenliği ve doğrulama

Önizleme çerçevesi yalnızca uygulamanın sabit `srcDoc` belgesini yükler. WebKit’te üst pencerenin React olay işleyicilerinin çalışabilmesi için sandbox `allow-same-origin allow-scripts` kullanır. Çerçevenin CSP politikası `script-src 'none'` ile çerçeveye eklenen script ve satır içi olay işleyicilerini reddeder; dış kaynaklar varsayılan olarak kapalıdır. Kullanıcı HTML’i çerçevenin belge kaynağı olarak yüklenmez.

2026-10-04 denetiminde core-runtime debugger/scenario, script-schema fixture/gizlilik, Designer recording/time travel/lint, API regresyon/onay ve gerçek iframe etkileşim testleri çalıştırıldı. Tarayıcı regresyonu, çerçeveye eklenen script ve `onclick` canary’lerinin çalışmadığını ayrıca doğrular. Ayrıntılı sonuçlar ve sınırlar: [ürün denetim raporu](verification/PRODUCT_AUDIT_2026-10-04.md).

Hedefli tekrar komutları:

```sh
pnpm --filter @verbis/core-runtime exec vitest run src/debugger.spec.ts
pnpm --filter @verbis/script-schema exec vitest run src/schema/preview.spec.ts
pnpm --filter @verbis/designer-web exec vitest run src/preview/controller.spec.ts
pnpm --filter @verbis/api exec vitest run --project unit src/modules/scripts/preview.service.spec.ts src/modules/integrations/authoring.spec.ts
pnpm --filter @verbis/api exec vitest run --project integration test/integration/authoring-routing.int.spec.ts
pnpm --filter @verbis/designer-web exec playwright test e2e/preview.spec.ts
```

Canlı dış platformlar için müşteri ortamı kabulü bu yerel önizleme doğrulamasının dışındadır.

## Okunur adlar ve sağlık kontrolü (2026-10-21)

- Veri kaynağı panelleri ve sahte yanıt alanları kod adıyla değil, sözcüklerle görünür: alanı dolduran
  değişkenin görünen adı (yerleşik şablonlarda Türkçe), yoksa alan adı sözcüklere ayrılmış hâliyle
  ("Order lookup"). Türkçe arayüzde "mock" yerine "sahte yanıt" / "örnek yanıt" kullanılır.
- Sağlık puanı, değeri sayfa kapsamlı bir değişkende tutulan zorunlu alanı yakalar
  (`VERBIS_LINT_PAGE_SCOPED_REQUIRED`): ajan sonraki sayfaya geçince değer silinir ve tamamlayan sonuç
  (ADR-0055) o alanda takılır; hata olarak işaretlenir. Koşullu zorunlu alan (`requiredWhen`, ör. telekom
  şablonunda "kod doğrulanana kadar") yazarın bilinçli çözümüdür ve işaretlenmez; çağrının yalnız
  bitebileceği son sayfalar da işaretlenmez. Taslakta "… değişkenini oturum kapsamına al" düzeltmesi tek
  geri alma adımıdır.
