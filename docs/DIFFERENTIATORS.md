# Verbis Farklılaştırıcılar — Awaken'ı geçme tasarımı

İlgili: [COMPETITIVE](COMPETITIVE.md) · [ROADMAP](ROADMAP.md) · [PROGRESS](PROGRESS.md) · [ADR-0027](adr/0027-preview-debugger-and-regression.md) · [ADR-0028](adr/0028-lifecycle-collaboration-and-package-v2.md) · [ADR-0031](adr/0031-session-analytics-and-reporting.md) · [ADR-0032](adr/0032-tenant-ai-and-human-review.md)

**Tarih:** 2026-10-06 · **Durum:** tasarım önerisi; Dalga 1, 2 ve 3 uygulandı; Dalga 4 ve 5'in model gerektirmeyen veya veri modelini değiştirmeyen kısımları uygulandı, geri kalanı ADR önerisi olarak bekliyor (2026-10-07; her maddenin "Durum" satırı). Rakip özelliklerine dair satırlar hipotezdir ([COMPETITIVE §3](COMPETITIVE.md#3-evaluation-plan) ölçümüyle doğrulanır).

**Kapsam dışı (kullanıcı kararı, 2026-10-06):** gerçek CTI/vendor kurulumu, SQL/iç ağ erişiminin sahada kurulması ve kurulum kolaylığı. Bunları kullanıcı kendi sisteminde kuracak; bu belge yalnız ürün farklılaştırıcılarını kurgular.

---

## 0. Hedef ve kalite çıtası

**Tek cümle hedef:** Bir tasarımcı ilk scriptini 30 dakikada yayınlasın, bir ajan yeni scripti eğitimsiz kullansın, bir yönetici scriptin işe etkisini sayıyla görsün; ve bunların her biri güvenlik/denetim garantisi altında olsun.

### 0.1 "Apple seviyesi" ne demek (ölçülebilir)

| İlke | Bizde karşılığı | Ölçüt (her PR'da kontrol) |
|---|---|---|
| **Netlik** | Her ekranda tek birincil eylem; ikincil eylemler geri planda | Tasarım incelemesinde "birincil eylem" işaretli; ekran başına ≤1 primary button |
| **Saygı (deference)** | İçerik (script) öne, araç arka plana; paneller ihtiyaçta açılır | Canvas alanı 1440px'te ≥%65 |
| **Derinlik** | Katmanlar anlamlı: hareket nereden geldiğini anlatır | Hareketler token'lı spring eğrileri; `prefers-reduced-motion` ile anında |
| **Hız hissi** | Her etkileşim anında tepki verir | INP p75 < 100 ms, sayfa geçişi < 150 ms, canvas sürükleme 60 fps (500 node) |
| **Affedicilik** | Her şey geri alınabilir, hiçbir şey kaybolmaz | Tüm mutasyonlar undo'lu; yıkıcı eylem öncesi önizleme; otomatik taslak |
| **Tutarlılık** | Yalnız `@verbis/ui` token/bileşenleri | Görsel regresyon baseline'ı, ad-hoc renk lint'i |
| **Erişilebilirlik** | WCAG 2.2 AA, klavye ilk sınıf | axe 0 ihlal; her akış yalnız klavyeyle tamamlanır |
| **Zanaat** | Boş/yükleniyor/hata/kısmi durumların hepsi tasarlanmış | Bileşen başına 5 durum Storybook hikayesi zorunlu |

**Süreç:** (1) her özellik için önce etkileşim prototipi + hareket spesifikasyonu, (2) "craft review" kontrol listesi PR şablonunda ([.github/pull_request_template.md](../.github/pull_request_template.md)), (3) çeyrekte bir 8 kişilik kullanılabilirlik testi, hedef **SUS ≥ 85**, (4) kendi ürünümüzle kendi demo scriptlerimizi yazarız (dogfooding).

---

## 1. Yedi farklılaştırıcı sütun

Her madde: **Deneyim** (kullanıcı ne görür) · **Yöntem** (en iyi teknik) · **Mevcut temel** · **Kabul ölçütü** · **ADR gereksinimi**.

### Sütun A — Tasarımcı deneyimi: "düşünce hızında yazım"

**A1. Canlı çift panel (Edit ⇄ Agent View)**
- Deneyim: Solda düzenleme, sağda gerçek ajan görünümü; her değişiklik anında yansır. TR/EN, açık/koyu, telefon/masaüstü/gömülü CTI çerçevesi tek tuşla.
- Yöntem: Tek yorumlayıcı (ADR-0024 paylaşılan interpreter) üzerine Yjs güncellemesini doğrudan önizleme store'una patch olarak akıtmak; tam yeniden render yok. Önizleme ayrı origin'li iframe değil, aynı React ağacında izole store ile.
- Temel: `preview/studio.tsx`, `preview/device.tsx`.
- Kabul: düzenleme → önizleme p95 < 50 ms (500 node).
- **Durum (2026-10-07):** ilk sürüm uygulandı. Ekran modunda "Ajan görünümü" düğmesi (tercih tarayıcıda hatırlanır) canvas yanında etkileşimli simülasyonu açar; telefon/tablet/masaüstü, TR/EN ve açık/koyu/yüksek kontrast segmentleri; "Baştan başlat". **Durumu koruyan hot reload:** her düzenlemede yeni runtime kurulur, ajanın sayfası ve geçmişi `resume()` ile yan etkisiz geri yüklenir; değiştirdiği değişken değerleri tip uyumluysa taşınır, dokunulmamış varsayılanlar yeni değeri gösterir; sayfa akıştan çıktıysa baştan başlar. onEnter, veri kaynağı ve zamanlayıcılar yeniden çalışmaz; telemetri ve depolama yok, veri kaynakları mock. Tasarımcı editörde sayfa değiştirince görünüm o sayfaya geçer. 1281–1599 px'te görünüm inspector altına yerleşir, canvas genişliğini korur. Ölçüm (yerel Chromium, 500 node, 10 örnek): runtime yeniden yükleme p95 ≈ 8–10 ms; React/iframe render süresi bu sayıya dahil değildir. Açık: ajan görünümünden tasarımcıya "bu node'u seç" bağlantısı, düzenlenen node'un görünümde vurgulanması, mock veri kaynağı yanıtlarının bu panelden düzenlenmesi.

**A2. Komut paleti her şeyin merkezi**
- Deneyim: `⌘K` ile her eylem, her sayfa, her değişken, her bileşen ve her ayar; doğal dil komutları ("müşteri tipi VIP ise iade sayfasına git kuralı ekle").
- Yöntem: cmdk + bulanık arama (mevcut TR karakter normalizasyonu) + eylem kayıt defteri (her eylem tipli, undo'lu, yetki kontrollü). Doğal dil kısmı A5 ile AI'ya devredilir.
- Temel: `editor/search.ts`, cmdk zaten design system'de.
- Kabul: en sık 20 eylemin hepsi paletten; yeni kullanıcı görevlerinin %80'i fare olmadan.
- **Durum (2026-10-07):** ilk sürüm uygulandı. Çalışma alanında tek ⌘K paleti; sayfalar `useContributeCommands` ile bağlama özel komut katar (üretici fonksiyon yalnız palet açıkken çağrılır, editör her düzenlemede kabuğu render ettirmez). Editör komutları: 5 mod, 8 düzenleme eylemi (araç çubuğuyla aynı etkinlik kuralı, platforma göre ⇧⌘Z / Ctrl+Shift+Z), Script sağlığı, ajan görünümü, tam ekran, kısayollar, her sayfaya git, sorguyla eşleşen bileşenler (çevrilmiş metin dahil, en fazla 20), sürüklenebilir her bileşeni ekle, yakınlaştırma ve önizleme genişliği. Sıralama bizde (`rankCommands`): Türkçe karakter/i-ı duyarsız; tam önek > kelime öneki > tüm terimler > ≥3 karakterde sıralı harf; en iyi eşleşmenin grubu en üstte. "Son kullanılanlar" (kişi başına 5, tarayıcıda; o an pasif olan komut gösterilmez). Komut, palet kapanıp odak geri yüklendikten sonra çalışır (bileşene git odağı canvas'ta bırakır). Doğal dil komutları A5 ile gelecek. Kabul ölçütündeki "%80 fare olmadan" henüz kullanıcı testiyle ölçülmedi.

**A3. Doğrudan manipülasyon cilası**
- Deneyim: Akıllı hizalama kılavuzları, aralık ölçüleri, çoklu seçim, toplu özellik düzenleme, kopyala-yapıştır stil, "bunun gibi bir tane daha".
- Yöntem: dnd-kit + mevcut drop-guides; ölçü katmanı canvas üstünde ayrı SVG; çoklu seçim için tek patch transaction (tek undo adımı).
- Temel: `editor/drop-guides.tsx`, `editor/canvas.tsx`.

**A4. Script Sağlık Puanı (gerçek zamanlı statik analiz)**
- Deneyim: Sağ üstte 0-100 puan; tıklayınca sorun listesi, her sorun "düzelt" butonlu.
- Kontroller: erişilemeyen sayfa/dal, sonsuz döngü, kullanılmayan/tanımsız değişken, tip uyuşmazlığı, eksik çeviri, a11y (etiketsiz alan, kontrast), PII'nin maskesiz gösterimi, zorunlu yasal metnin (KVKK aydınlatma vb.) eksikliği, veri kaynağı hata yolu tanımsız, test edilmeyen dal.
- Yöntem: `@verbis/expr` bağımlılık/tip analizi + akış grafiği üzerinde erişilebilirlik (BFS) ve döngü tespiti (Tarjan SCC); kural tabanlı lint motoru Web Worker'da, artımlı (yalnız değişen alt ağaç).
- Temel: `preview/lint.ts`, expr dependency analysis.
- Kabul: 500 node'da artımlı analiz < 30 ms; her kural için düzeltme önerisi.
- **Durum (2026-10-06):** ilk sürüm uygulandı. Editör araç çubuğunda puan halkası + yan panel; 6 kategori (akış, veri ve mantık, gizlilik ve uyum, erişilebilirlik, dil, performans); her bulgu için okunur konum ve "Git" (sayfa/bileşen seçimi + canvas odağı, ya da akış/kural/değişken editörü). Puan: hata 12 / uyarı 4 / ipucu 1, aynı kuralın tekrarı azalan ağırlıkla (1, ½, ⅓ …), gizlilik ×2, kategori tavanı 35, herhangi bir hata varsa en fazla 59. Yeni kontrol: kullanılmayan değişken; kullanılmayan PII/PCI değişkeni veri minimizasyonu uyarısıdır (`@verbis/script-schema` `unusedVariables`). Açık: Web Worker'da artımlı analiz ve 500 node ölçümü, otomatik "düzelt" eylemleri, test edilmeyen dal kontrolü (B3 ile).

**A5. Yazım copilot'u (AI, guardrail'li)**
- Deneyim: "Kredi kartı kaybı bildirimi scripti: kimlik doğrulama, kart bloke, yeni kart, anket" → sayfa+akış+kural taslağı, tasarımcı kabul/ret eder. Ayrıca: metni sadeleştir, TR↔EN çevir, bu diff'i açıkla, bu dal için test verisi üret.
- Yöntem: Yapılandırılmış çıktı (JSON schema = `@verbis/script-schema`), zod doğrulaması başarısızsa otomatik onarım döngüsü (en fazla 2). Çıktı her zaman öneri (suggestion) modunda gelir, asla doğrudan yazılmaz. PII gate (ADR-0032) prompt öncesi.
- Temel: `pages/ai.tsx`, ADR-0032 review UI.
- Kabul: değerlendirme setinde (50 brif) şema geçerliliği %100, insan kabul oranı ≥ %70.
- ADR: **evet** (üretken taslak yetkisi, değerlendirme seti, model seçimi).

**A6. Yapı taşları ve doğrulanmış şablonlar**
- Deneyim: Hazır, test edilmiş bloklar: kimlik doğrulama (ID&V), şikâyet alma, iade, satış kapanışı, KVKK aydınlatma, anket, geri arama planlama. Blok içinde regresyon senaryoları ve sağlık puanı hazır gelir.
- Yöntem: Mevcut paylaşılan ekran (linked/detached) + şablon altyapısı; blok sürümlü, bağımlılık etkisi gösterilir.
- Temel: `lifecycle/templates.tsx`, `pages/shared-screens.tsx`.
- Kabul: sıfırdan kullanıcı, şablonla 5 sayfalık scripti ≤ 30 dk'da yayınlar.
- **Durum (2026-10-07):** ilk sürüm. 4 yapı taşı (`editor/blocks.ts`): KVKK aydınlatma (açık rıza varsayılan `false`, önceden işaretli değil), kimlik doğrulama (TCKN ve doğum tarihi `pii`), memnuniyet anketi, geri arama. Ekleme katmanlar panelinden ve ⌘K'dan; çakışan değişken anahtarları yeniden adlandırılır (`key2` …), mevcut çeviriler ezilmez, sayfa akışta bitişten önceye bağlanır; salt okunur taslakta reddedilir. 6 yerleşik şablon artık sentetik regresyon senaryolarıyla gelir ve hepsi yayın kapısını geçer (API testi). Senaryo yazımı mevcut şablonlarda gerçek hatalar çıkardı ve düzeltildi: telekomda var olmayan `today()` (→ `now()`), ham veri kaynağı sonucunun platforma geri yazımı (engelleniyordu; `internal` sınıflı ara değişkenle), sayfadan çıkınca temizlenen alanda `requiredWhen: true`; tahsilatta aynı geri yazım ve ret yolunu kilitleyen zorunlu alanlar. Kredi kartı `TECH_ERROR` ve tahsilat `WRONG_PARTY` bitişlerindeki `outcome` geçici olarak kaldırıldı (zorunlu sayfa kuralı, bkz. [ADR-0047](adr/0047-early-exit-outcomes.md) önerisi). Açık: şikâyet, iade, satış kapanışı blokları; blok sürümleme ve bağımlılık etkisi; 30 dk kabulü kullanıcı testi ister.

**A7. İlk 5 dakika**
- Deneyim: Boş durumda 3 seçenek (şablondan, AI'dan, boş); 60 sn'lik etkileşimli tur; örnek tenant verisi.
- Kabul: ilk yayın süresi medyanı ölçülür (ürün içi telemetri, PII'siz).
- **Durum (2026-10-07):** kısmi. Yeni script diyaloğunda "Başlangıç" seçimi: Boş (varsayılan) veya Şablondan; şablon modunda kampanya gerekmez, `POST /v1/templates/:id/instantiate` sonrası doğrudan ilk sürümün editörü açılır; liste yüklenemezse yeniden dene. Açık: AI seçeneği (A5 ile), etkileşimli tur, örnek tenant verisi, ilk yayın süresi telemetrisi.

---

### Sütun B — Kalite ve hata ayıklama: "hatayı üretimden önce bul"

**B1. Zaman yolculuklu debugger**
- Deneyim: Zaman çizelgesinde ileri/geri adım; her adımda değişken farkı, tetiklenen kural, veri kaynağı istek/yanıtı (redakte). Koşullu breakpoint ve watch ifadeleri.
- Yöntem: Olay kaynaklı (event-sourced) oturum durumu; her N adımda snapshot + arada olay tekrarı (snapshot+replay). Saat, ID ve rastgelelik enjekte (zaten test kuralımız).
- Temel: ADR-0027 breakpoint/watch/timeline/state restore.
- Kabul: 1.000 adımlık oturumda herhangi bir adıma atlama < 100 ms.
- **Durum (2026-10-07):** ilk sürüm (önizleme stüdyosu). "Geri adım": durumu son anlık görüntüden farklı olan en yakın önceki adıma döner (aynı durumlu ara adımlar atlanır). Zaman çizelgesinde her satırın altında o adımda değişen değişkenler; `pii`/`pci` değişkenler yalnız "değişti" olarak, değersiz gösterilir. İzleme ifadeleri sandbox'lı ifade motorunda (ADR-0007) değerlendirilir, yan etkisi yoktur; `pii`/`pci` okuyan ifade hiç çalıştırılmaz, "maskeli" döner; en fazla 20 ifade, 500 karakter, kalıcı değil. Açık: olay kaynaklı snapshot+replay, koşullu breakpoint, tetiklenen kural ve veri kaynağı istek/yanıtı görünümü, 1.000 adım < 100 ms ölçümü.

**B2. Gerçek oturum replay'i (deterministik)**
- Deneyim: Analitikte sorunlu bir oturumu seç → "Debugger'da aç" → aynı script sürümü, redakte veri ve kaydedilmiş I/O ile birebir tekrar oynar.
- Yöntem: Oturum olayları + veri kaynağı yanıtları redakte edilerek saklanır; replay sırasında ağ yerine kayıtlı yanıtlar (record/replay), zamanlayıcılar sanal saatle. Erişim yetki ister ve denetlenir (hassas veri okuması).
- Temel: ROADMAP P1 "Debugger gerçek I/O/timer continuation replay değil".
- ADR: **evet** (saklama süresi, redaksiyon sınıfları, provenance, iptal güvenliği).
- **Durum (2026-10-07):** kısmen uygulandı: **yol tekrarı (yalnız üst veri)**. Yeni veri kaydedilmez; çalışma zamanının zaten tuttuğu olay günlüğünden (`page.entered`, `field.changed`, `session.transitioned`, `timer.started`) sürümün sayfaları üzerinde adım adım yol, sayfada geçen süre ve hiç ulaşılmayan sayfalar çıkarılır (`GET /v1/sessions/:id/replay`, tasarımcıda `/scripts/:id/versions/:number/replay`). Değerler çalışma zamanının redakte ettiği hâliyle gösterilir; her görüntüleme `runtime.session.replayViewed` ile denetlenir; erişim `read:Session` (takım kapsamlı ABAC). Kayıtlı veri kaynağı yanıtlarıyla birebir yeniden oynatma ve debugger'da açma **yapılmadı** (DPO kararı bekliyor). Ayrıntı: [ADR-0050](adr/0050-deterministic-session-replay.md).

**B3. Otomatik yol keşfi ve test üretimi**
- Deneyim: "Tüm yolları test et" → sistem her dalı açan giriş kombinasyonlarını üretir, kapsama haritasını canvas'a boyar (yeşil: test edildi, kırmızı: hiç geçilmedi).
- Yöntem: Kural motoru AST'si üzerinde koşul toplama + basit kısıt çözümü (sınır değer analizi; enum/aralık/eşitlik için yeterli, genel SMT gerekmez); fast-check ile property-based ek senaryolar.
- Temel: regresyon senaryoları (`preview/regression-panel.tsx`), expr analizi.
- Kabul: referans scriptlerde dal kapsamı ≥ %95 otomatik.
- **Durum (2026-10-07):** ilk sürüm. Kayıtlı senaryolar yerel, yalnız mock motorda (senaryo başına 2 s) çalıştırılır; ölçüt ana akış ve alt akışlarda **kenar (dal) kapsamı**. Panel yüzdeyi, başarısız senaryo sayısını ve test edilmeyen dalları gösterir; kapsanan node/kenarlar ana akış tasarımcısında boyanır. Her dal için "Üret": dalın kaynağına ulaşan en fazla 3 senaryodan (yoksa boş tabandan) başlayıp kardeş koşulların okuduğu değişkenlerde sınır değerleri (sayı ±1/0, boolean, enum, string) dener, veri kaynağı hata/başarı portları için mock türünü değiştirir; bütçe 48 deneme. `global`, `pii` ve `pci` değişkenler hiçbir zaman değiştirilmez. Bulunan senaryo gözlenen sonucu bekler ve tek tıkla eklenir (en fazla 20 senaryo). Açık: fast-check ile ek senaryolar, alt akış boyama, referans scriptlerde %95 ölçümü.

**B4. Sözleşmeden mock veri kaynakları**
- Deneyim: Web servisini bağlamadan çalış; örnek yanıtlar şemadan üretilir, hata/zaman aşımı/yavaş yanıt tek tıkla simüle edilir.
- Yöntem: Entegrasyon tanımındaki JSON Schema'dan üretim; kaos anahtarları (gecikme, 500, boş liste).
- Temel: ADR-0038 production integration mocks.
- **Durum (2026-10-07):** kısmi. Önizlemede "Şemadan doldur": veri kaynağının yanıt şemasından deterministik örnek üretir (`const`/`example`/`default`/`enum` öncelikli; yoksa tipli yer tutucu, format duyarlı; derinlik 6) ve tanımlı çıktı yollarına yansıtır. Açık: kaos anahtarları (gecikme, 500, boş liste) tek tıkla; veri kaynağı araması ilk 20 sonuçla sınırlı ve sürüm eşlemesi yapmıyor.

**B5. Yayın kapısı ve risk puanı**
- Deneyim: Yayın ekranında: yapısal diff, etkilenen kampanyalar/ajan sayısı, kırılan testler, sağlık puanı değişimi, risk seviyesi.
- Yöntem: Mevcut onay/SoD akışına zorunlu kontroller (required checks) — PR mantığı.
- Temel: ADR-0027 publication regression, `lifecycle/release.tsx`.
- **Durum (2026-10-07):** ilk sürüm, **tavsiye niteliğinde** (sunucu yayın kapısı yetkili kalır). Yayın ekranında gerekçeli risk kartı: sağlık hataları/düşük puan, senaryo yokluğu ve kapsama, yeni (özellikle riskli) kişisel veri akışları, değişiklik büyüklüğü, silinen sayfalar, geniş etki; puan 100 tavanlı, düşük/orta/yüksek. Etkilenen atama ve kampanya sayısı `GET /v1/assignments?scriptId=` ile (tek sayfa, en fazla 100; hata ya da yetki yoksa "bilinmiyor"). Veri haritası (G3) kartta açılır. Açık: sayfalama, kırılan testlerin sunucu sonucu ile birleşmesi, zorunlu kontrollerin onay akışına bağlanması.

---

### Sütun C — Ekip çalışması: "Figma gibi birlikte, Git gibi güvenli"

**C1. Çok oyunculu düzenleme 2.0**
- Deneyim: Canlı imleçler, seçim halkaları, "takip et" modu (bir kişinin görünümünü izle), node'a iğnelenmiş yorumlar, @bahsetme, emoji tepkisi yok (kurumsal sadelik).
- Yöntem: Yjs + awareness (ADR-0028); takip modu awareness üzerinden viewport yayını.
- Temel: `lifecycle/collaboration.tsx`, `comments.tsx`.
- **Durum (2026-10-07):** kısmi. Kişiye özel, oturumlar arası sabit renk (kullanıcı kimliğinin özetinden 6 token tonundan biri; tehlike rengi kullanılmaz) imleç, seçim kutusu ve avatarda. Takip modu: avatar açma/kapama düğmesi; takip edilenin sayfasına geçer ve seçtiği ilk node'u görünüme kaydırır, **seçmez** (takip eden seçim yayınlamaz); tekrar tıklama, sunum alanı dışında tıklama/tuş ya da kişinin ayrılması takibi bitirir; ekran okuyucuya duyurulur. Açık: viewport (yakınlaştırma/kaydırma) yayını, @bahsetme.

**C2. Öneri modu (track changes)**
- Deneyim: İnceleyici doğrudan değiştirmez, öneri bırakır; sahip tek tek kabul/ret eder.
- Yöntem: Öneriler ayrı Yjs alt dokümanında patch olarak; kabul = ana dokümana uygulama (tek transaction, denetim olayı).
- ADR: **evet**.
- **Durum (2026-10-07):** uygulandı (öneriler; dallar C3'te açık). Düzenleyicide **Öneri modu** (araç çubuğunda simge): kayıt kapalı, yerel düzenleme; "Değişiklikleri öner" farkı bağımsız RFC 6902 işlemleri olarak gönderir (`suggestOperations`, ≤200 işlem). Sahip `Öneriler` panelinde (düzenleyici ortak çalışma bölümü ve sürüm sayfası) kabul/ret eder; kabul normal taslak güncellemesinden geçer (`script.suggestion.created/accepted/rejected` denetim olayları, tablo `script_suggestions` RLS'li). Eskiyen öneri koruma değerleriyle belirlenir (kayıtlı taban belge yok, otomatik çözüm yok). Ayrıntı ve kararlar: [ADR-0051](adr/0051-suggestion-mode-and-branches.md). Açık: yeni önerinin sahibe bildirimi, canvas üzerinde öneri katmanı, bayat önerinin `mergeDocuments` ile yeniden tabanlanması.

**C3. Dallar ve yapısal birleştirme**
- Deneyim: "Kampanya Kasım" dalı aç, deney yap, ana sürüme birleştir; çakışma görsel olarak node bazında çözülür.
- Yöntem: Kararlı node ID'leri (zaten kural) sayesinde üç yollu yapısal birleştirme; metin değil ağaç düzeyinde. Çakışma çözüm UI'ı görsel diff üzerine.
- Temel: `lifecycle/diff.ts`, `visual-diff.tsx`.
- ADR: **evet** (dal modeli, yaşam döngüsü ile ilişkisi).
- **Durum (2026-10-07):** uygulandı (görsel çakışma çözücü hariç). Dal = tek çalışma sürümü (`script_versions.branch` + `parent_version_id`), ana hat sürümünden başlar; **yayınlanamaz** (`VERBIS_BRANCH_NOT_PUBLISHABLE`). Birleştirme üç yönlüdür (ata, ana hat başı, dal); çakışma varsa **reddedilir** ve yollar listelenir, çakışmasızsa yeni ana hat taslağı oluşur (olağan inceleme/SoD/yayın kapısı). Script sayfasında "Dallar" paneli: oluştur, düzenle, birleştirme önizlemesi. Ayrıntı: [ADR-0051](adr/0051-suggestion-mode-and-branches.md). Açık: node bazında görsel çakışma çözümü, dal üstünde birden çok sürüm.

**C4. Kademeli yayın (canary) ve otomatik geri alma**
- Deneyim: Yeni sürümü ajanların %5'ine aç; hata oranı/AHT bozulursa otomatik geri al ve bildir.
- Yöntem: Atama düzeyinde ağırlık (A/B altyapısı yeniden kullanılır) + guardrail metriği eşikleri + ardışık test (D2).
- ADR: **evet**.
- **Durum (2026-10-07):** API ve otomatik geri alma uygulandı ([ADR-0049](adr/0049-canary-rollout-on-ab-assignments.md)). Kanarya, adı `stable`/`canary` olan iki kollu A/B atamasıdır; aşama canary ağırlığı (%5 → %25 → %50 → %100), değişiklik mevcut `PATCH /v1/assignments/:id` ile yapılır. `GET /v1/assignments/:id/rollout` son 14 günün analitiğinden `hold`/`advance`/`rollback` kararı ve uygulanacak `variants` önerisi verir. Geri alma yalnız **olumsuz kanıtla** (guardrail'de ya da tamamlamada anlamlı kötüleşme; her an geçerli p-değeri); ilerleme yalnız tavsiyedir. `ROLLOUT_GUARD_ENABLED` (varsayılan kapalı, analitik gerekir) 60 sn'lik bekçiyi açar: yalnız geri alır, canary ağırlığını 0 yapar, `assignment.rollout.rolledBack` denetim olayı yazar, tekrar çalışmada dokunmaz. Gerçek Postgres'te entegrasyon testli. **Yok:** tasarımcıda aşama arayüzü, tenant bazlı eşikler, insanlara bildirim (yalnız denetim/SIEM akışı).

**C5. Ajandan tasarımcıya geri bildirim döngüsü**
- Deneyim: Ajan herhangi bir node'da "bu adım kafa karıştırıcı" der → tasarımcıda o node'a iğnelenmiş yorum olarak düşer (PII'siz, oturum referanslı).
- Yöntem: agent-web'de hafif geri bildirim eylemi → yorum servisi; denetim olayı.
- **Durum (2026-10-07):** ilk sürüm. Ajan adım başlığının yanındaki "Geri bildirim" ile sabit nedenlerden birini seçer (kafa karıştırıcı, yanlış, eksik adım, çok uzun); serbest metin yok. `POST /v1/sessions/:id/desktop/feedback` (yalnız oturum sahibi, `read:Session`; OpenAPI'de) sayfanın kök node'una iğnelenmiş, yalnız geri bildirim içeren bir başlığa yazar (500 mesajda yeni başlık; tasarımcı konuşmalarına eklenmez). Denetim: `runtime.desktop.feedbackSubmitted` ve `script.comment.created` (`source: agentFeedback`). Yorum başlığında oturum referansı tutulmaz; denetim olayının hedefi oturumdur. Tasarımcıda "ajan geri bildirimi" rozeti ve nedeni; script geneli görünüm de listeler. Açık: uç noktaya özel hız sınırı (yalnız genel sınırlayıcı var), toplu sayaç/ısı haritası.

---

### Sütun D — Ajan deneyimi: "müşteriye bakarken kullanılabilen ekran"

Müşterinin gözünde ürün, ajanın gördüğü ekrandır. En büyük fark burada yaratılır.

**D1. Sıfır gecikme hissi**
- Yöntem: Olası sonraki sayfaların önceden hesaplanması (akış grafiğinden komşular), veri kaynağı ön-getirme (yalnız idempotent GET), iyimser UI, skeleton yerine anında içerik.
- Kabul: sayfa geçişi p95 < 100 ms; launch redeem → ilk ekran p95 < 300 ms.
- **Durum (2026-10-07):** ölçüm uygulandı, optimizasyon iddiası yok. Bileşenler tembel yüklenmediği için önceden getirme bu aşamada kazanç sağlamaz; gecikme sunucu senkronundan gelir. Sayfa geçiş süresi `agent.page_transition` span'ı olarak (yalnız süre) gönderilir; İleri düğmesi yalnız 150 ms'yi aşan adımlarda ilerleme gösterir. Yerel mock'ta klavyeyle tam adım (istek dahil) e2e'de ölçülür; gerçek p95 üretim/staging telemetrisiyle doğrulanmalıdır.

**D2. Odak modu ve aşamalı gösterim**
- Deneyim: Yalnız şimdiki adım ve bir sonraki olası eylem büyük; geçmiş adımlar katlanır; ilerleme çubuğu "nerede olduğumu" gösterir.
- Kabul: yeni ajan, eğitimsiz görev başarı oranı ≥ %90 (kullanılabilirlik testi).
- **Durum (2026-10-07):** ilk sürüm. Her adımda "Adım N" ve müşteri yüzlü sayfa başlığı; "Geçilen adımlar" listesi (sunucu görünüm geçmişinden). Odak modu (Alt+F veya ayarlar; kalıcı tercih, varsayılan kapalı): daha büyük yazı, ortalanmış adım, belirgin İleri. Sayfa değişince odak ilk alana (yoksa başlığa) gider, ekran okuyucuya duyurulur. %90 eğitimsiz başarı ölçütü kullanıcı testi ister.

**D3. Canlı uyum kontrol listesi**
- Deneyim: Zorunlu ifadeler/onaylar (KVKK aydınlatma, kayıt bildirimi, satış koşulları) yan panelde; tamamlanmadan wrap-up kapanmaz; her onay denetlenir.
- Yöntem: Script şemasında `compliance` işaretli node'lar; runtime'da durum makinesi; olay → audit.
- ADR: **evet** (şema genişlemesi, minor sürüm + migrasyon).
- **Durum (2026-10-07):** uygulandı, **şema değişikliği olmadan**. Önceden var olan `mustRead` metin düğümü, `runtime.read.<id>` durumu, onay denetimi (`runtime.session.textacknowledged`) ve analitik uyum oranı yeterliydi; eksik olan ajan panelindeki canlı listeydi. Yan panelde "Zorunlu bildirimler" sekmesi (bekleyen sayısıyla): sayfa sırasıyla bildirimler, hangi sayfada oldukları, metinle durum (tamam/bekliyor). Durum runtime korumasının okuduğuyla birebir aynıdır (`runtime.read`, `acknowledged` prop'u, bağlı değişken), bu yüzden panel "tamam" derken koruma engellemeye devam edemez. Wrap-up'ı engellemez (müşteri kapatmış olabilir; erken çıkışlar için [ADR-0047](adr/0047-early-exit-outcomes.md)), bu yüzden ADR gerekmedi. Açık: görünürlük koşuluna bağlı gizli bildirimlerin listeden çıkarılması.

**D4. Klavye ilk sınıf**
- Deneyim: Her eylemin kısayolu, kısayol ipucu tuşu (`?`), sayısal seçim (1-9), sonraki alana akıllı odak.
- Temel: agent-web preferences/keyboard.
- **Durum (2026-10-07):** saf `shortcutIntent` sözleşmesi (23 vaka testli): Enter (tek satırlık yanıt sonrası da), Ctrl/⌘+Enter her yerden, Alt+← (yazarken değil), `?`/Ctrl+/ yardım diyaloğu, Alt+F odak modu, Alt+1…9 görüşme; fiziksel tuş kodları; diyalog ve kenar panelde (notlar) çalışmaz. Sayısal seçim (1–9 ile seçenek) henüz yok.

**D5. Bağlam kartı**
- Deneyim: Müşteri özeti (CTI/CRM'den gelen, maskeli), önceki etkileşim notu, aktif kampanya; PII açma tek tık + denetim.
- Temel: alan düzeyinde PII yetkisi (ADR-0013), maskeli supervisor.
- **Durum (2026-10-07):** kısmi, önceden vardı: yan panelde müşteri özeti/geçmiş/bilgi/itiraz sekmeleri bağlayıcı verisinden gelir; maskeli supervisor ve alan düzeyinde yetki var. **Yok:** tek tık PII açma ve her açma için denetim olayı ([ADR-0052](adr/0052-live-agent-ai.md) Proposed).

**D6. Çoklu oturum anahtarlayıcı**
- Deneyim: Aynı anda sohbet+e-posta+ses; her oturum izole durum, sekmede okunmamış/SLA göstergesi.
- Temel: Adım 30 (omnichannel) ile birleşir.
- **Durum (2026-10-07):** kısmi, önceden vardı: sekmeler, her oturum için izole durum, okunmamış rozeti, Alt+1…9 ile geçiş. **Yok:** SLA göstergesi (kanal başına hedef süre tanımı gerekir).

---

### Sütun E — Yapay zekâ: "yönetilen, ölçülen, açılıp kapanabilen"

**Durum (2026-10-07).** API katmanı önceden vardı ([ADR-0032](adr/0032-tenant-ai-and-human-review.md)): `draft`, `scenarios`, `reply`, `objection`, `summary` önerileri; PII kapısı, kota, insan onayı, denetim. Bu turda yalnız **deterministik ve model gerektirmeyen** parçalar yapıldı:

| # | Durum |
|---|---|
| E1 / A5 | Yeni iş yok: `draft` önerisi tasarımcı AI sayfasında zaten var. Editörde satır içi copilot canlı sağlayıcı ve yerel PII tanıyıcı ister; **yapılmadı**. |
| E2 | **Yapıldı (model yok).** Yayın ekranında "Değişikliklerden taslak oluştur": iki sürüm arasındaki yapısal farktan (sayfa, bileşen, değişken, sınıf değişimi, kural, veri kaynağı, akış, metin sayısı, senaryo) olgusal sürüm notu taslağı. Yalnız ad/sayı/sınıf içerir, metin ve değer içermez; mevcut notun üzerine yazmaz. |
| E3 | B3 zaten dal başına deterministik senaryo üretiyor ve doğruluyor; AI varyantı **yapılmadı**. |
| E4–E6 | **E4 kısmen uygulandı (2026-10-07):** yeni `navigate` AI görevi — sohbet/e-posta etkileşiminde ajan istediğinde, oturumun sabitlenmiş script sürümünün (gösterilen sayfa hariç) sayfa listesi arasından **yalnız verilen sayfa kimliklerinden** biri ya da `null` önerilir; sunucu kimliği doğrular (uydurma → `VERBIS_AI_OUTPUT`), ajan onaylayana kadar gezinme yok, onayda `runtime.navigate` doğrulamalarla gider. Aynı PII maskeleme, kota ve denetim yolundan geçer (ADR-0032). **Canlı transkript akışı, 1,5 sn gecikme bütçesi, E5 (uyum ifadesi) ve D5 (PII açma) yapılmadı:** [ADR-0052](adr/0052-live-agent-ai.md). E6 için `summary` görevi zaten sonuç kodunu kampanyanın kodlarıyla sınırlı öneriyor.
| E7 | **Yapıldı (model yok).** Analitik paneli "Optimizasyon içgörüleri": terk, yavaş sayfa (medyanın ≥ 2 katı), hata veren alan, yavaş/hatalı veri kaynağı; ≥ 30 örnek eşiği, etkiye göre sıralı, en çok 10, sabit öneri anahtarları (serbest metin yok). Yeniden yazım önerisi ve "A/B olarak dene" tek tık **yok** (kanarya için C4 API'si kullanılabilir). |

Her AI özelliği: tenant opt-in, PII gate (ADR-0032), çıktı şema doğrulaması, insan onayı, değerlendirme seti, maliyet kotası, denetim olayı. Bu yönetişim katmanı başlı başına farklılaştırıcıdır.

| # | Özellik | Kim için | Yöntem | ADR |
|---|---|---|---|---|
| E1 | Yazım copilot'u | Tasarımcı | A5 | evet |
| E2 | Diff açıklama + sürüm notu taslağı | İnceleyici | Yapısal diff → özet; şema dışı serbest metin yalnız açıklama alanında | hayır (ADR-0032 kapsamı) |
| E3 | Test senaryosu üretimi | Tasarımcı | B3'ün eksik bıraktığı dallar için AI önerisi, sonra B3 doğrular | hayır |
| E4 | Canlı ajan yardımı: niyet → sayfaya atla önerisi | Ajan | Transkript akışı (sağlayıcı bağımsız arayüz) → niyet sınıflandırma → öneri; ajan onaylamadan gezinme yok | **evet** (konuşma verisi, gecikme bütçesi, sağlayıcı) |
| E5 | Uyum ifadesi tespiti | Ajan / QA | Transkriptte D3 maddelerinin söylendiğini işaretle | E4 ile |
| E6 | Wrap-up özeti + sonuç kodu önerisi | Ajan | Oturum olayları (+ varsa transkript) → yapılandırılmış özet | E4 ile |
| E7 | Script optimizasyon içgörüsü | Yönetici | F2 analitiğinden: en çok düşüş/uzun süre olan node'lar + yeniden yazım önerisi + "A/B olarak dene" tek tık | hayır |

---

### Sütun F — Deney ve analitik: "hangi script daha iyi, sayıyla"

**F1. Doğru istatistikle A/B**
- Yöntem: Ardışık test (always-valid p-değeri / mSPRT) → sonuçlara erken bakmak yanıltmaz; CUPED ile varyans azaltma (önceki dönem AHT'si kovaryat); çoklu metrikte guardrail (uyum oranı, transfer oranı) ayrı.
- Temel: atama `abTest`, sticky bucketing, ADR-0031 analitik.
- ADR: **evet** (istatistik yöntemi sözleşmesi).
- **Durum (2026-10-07):** uygulandı ([ADR-0048](adr/0048-sequential-ab-inference.md)). Her karşılaştırma `anytimePValue`/`anytimeSignificant` taşır (normal karışımlı mSPRT, τ = 0,05, kol başına ≥ 30 oturum): deney sürerken tekrar tekrar bakmak yanlış pozitifi şişirmez (400 deterministik A/A denemesi × 40 bakış: sıralı test ≤ %5, saf z-testi > %10). Guardrail'ler (terk, zorunlu bildirim uyumu) birincil metrikten ayrı karşılaştırılır ve anlamlı kötü kolu adlandırır; çoklu kolda Bonferroni. CUPED saf fonksiyon olarak yazıldı ve test edildi ama panele **bağlanmadı** (ajan başına önceki dönem özeti için ayrı okuma modeli ve gizlilik incelemesi gerekir).

**F2. Yol analitiği**
- Deneyim: Akış üzerinde Sankey: ajanlar hangi yoldan geçiyor, nerede bırakıyor, node başına süre; heatmap canvas'a bindirilmiş.
- Temel: `editor/heatmap.tsx`, metadata-only projeksiyonlar.
- **Durum (2026-10-07):** önceden vardı ([ADR-0031](adr/0031-session-analytics-and-reporting.md)): sayfa geçiş grafiği (Sankey), sayfa başına bırakma ve süre, düzenleyicide node ısı haritası. Bu turda yalnız E7 içgörüleri eklendi.

**F3. Çok kollu haydut (opsiyonel, deneyimli tenant'lar)**
- Yöntem: Thompson sampling ile trafiği kazanana kaydır; guardrail ihlalinde dur. Varsayılan kapalı (feature flag).
- **Durum (2026-10-07):** kısmi, **yalnız tavsiye**. `GET /v1/assignments/:id/allocation` herhangi bir A/B ataması için Beta posterior'larından Thompson örneklemesiyle önerilen ağırlıkları verir (4000 çekim, tohum atama kimliği + sayılar: aynı veri aynı öneri; kol başına %5 keşif tabanı; toplam tam 10 000; kol başına ≥ 50 oturum yoksa öneri yok; guardrail'de kötü kol 0 alır). Hiçbir şeyi uygulamaz: trafiği kaydırmak yine `PATCH variants` ile bir kişinin işidir, bu yüzden otomatik kayma için bayrak gerekmedi. **Yok:** otomatik uygulama ve arayüz.

**F4. Sürüm-sonuç ilişkisi**
- Deneyim: Her yayın zaman çizelgesinde işaret; AHT/dönüşüm grafiğinde "bu değişiklikten sonra" görünür; tek tık geri al (C4).
- **Durum (2026-10-07):** okuma modeli uygulandı. Analitik paneli "Yayın etkisi": script sürümü başına ilk görülme, oturum, tamamlama ve süre; aynı scriptin önceki sürümüne göre fark ve her an geçerli p-değeri. Gözlemseldir (zaman ve trafik karışımı kontrol edilmez), arayüz bunu yazıyla söyler. Tek tık geri alma için C4 ve `rollback` uç noktası vardır, panelden düğme **yok**.

---

### Sütun G — Güven: "görünür güvenlik"

Güçlü olduğumuz yer; müşteri bunu **görmeli**.

**G1. Güven merkezi (admin-web)**
- Audit zinciri doğrulama ekranı (son checkpoint, imza durumu, kırılma yok), launch güvenliği istatistiği (reddedilen replay denemeleri), PII erişim raporu, veri saklama/silme durumu.
- Temel: ADR-0014 verify API, ADR-0030.
- **Durum (2026-10-07):** uygulandı. `GET /v1/trust-center?days=` (`read:Audit`; yalnız toplu sayılar): zincir doğrulama (geçerli, kontrol edilen olay, kırılma, imza, kısaltma, son imzalı kontrol noktası ve yaşı), güvenli başlatma sayaçları (oluşturulan, kullanılan, reddedilen/tekrar, anomali, reddedilen URL parametresi), hassas erişim sayıları (denetim dışa aktarımı, sır meta verisi, kullanıcı profili, kişisel veri dışa aktarımı) ve gizlilik talepleri (açık/işlenen/en eski). Durum muhafazakârdır: kırılma `broken`; imzasız, kısaltılmış, kontrol noktasız ya da 24 saatten eski kontrol noktası `attention`, hiçbir zaman `healthy` değildir. Okuma denetlenir (`audit.trustCenter.viewed`). admin-web'de "Güven merkezi" sayfası (7/30/90 gün). **Yok:** kimlik bazlı PII erişim raporu (yalnız sayılar), saklama/silme politikası durumu.

**G2. Uyum raporu dışa aktarımı**
- KVKK/GDPR işleme kaydı, PCI kapsam azaltma kanıtı, erişim incelemesi raporu: tek tık PDF/CSV, denetlenir.
- **Durum (2026-10-07):** kısmi. `GET /v1/compliance/processing-record?format=csv|json` (`export:Audit`): her scriptin **güncel yayınlanmış sürümü** için sınıflandırılmış (`pii`/`pci`) her değişkenin kaynakları, hedefleri, kalıcılığı ve `needsAttention` işareti (G3 veri haritasından; değer veya müşteri verisi içermez); CSV BOM'lu RFC 4180 ve formül enjeksiyonuna karşı korumalı; en fazla 500 script (kesilirse `truncated`); her dışa aktarım `compliance.processingRecord.exported` ile denetlenir. **Yok:** PDF, PCI kapsam azaltma kanıtı ve erişim incelemesi raporu (kimlik/rol verisi ayrı bir okuma modeli ister), arayüzden indirme düğmesi.

**G3. Script düzeyinde veri haritası**
- Her scriptin hangi PII/PCI alanına dokunduğu, hangi dış servise gönderdiği otomatik çıkarılır (şema sınıflandırma etiketlerinden); yayın kapısında gösterilir.
- **Durum (2026-10-07):** ilk sürüm. `@verbis/script-schema` `dataMap`: her `pii`/`pci` değişken için kaynaklar (bağlam, veri kaynağı, ajan girişi, script) ve hedefler (entegrasyon girdisi, ekran, toast, platform, analitik, log) ile kalıcılık; `newDataFlows` önceki sürüme göre yeni akışları verir. Sağlık panelinde ve yayın risk kartında tablo; riskli hedefler (her `pci` hedefi, log/analitiğe giden `pii`) ikon ve ekran okuyucu metniyle, yeni akışlar "yeni" etiketiyle. Açık: sunucu yayın kapısında zorunlu gösterim, dışa aktarım (G2 ile).

---

## 2. Dalga planı

Sıralama: önce ajan ve tasarımcının **her gün hissettiği** kalite, sonra ölçüm, sonra AI.

| Dalga | İçerik | Neden bu sırada | Yeni ADR |
|---|---|---|---|
| **1. Zanaat temeli** | §0.1 kalite çıtası + craft review şablonu; A1, A2, A3, A4; D1, D2, D4 | Her demo'da ilk görülen; diğer her şey bunun üzerine | — |
| **2. Güvenle yayın** | B1, B3, B4, B5; C1, C5; A6, A7; G3 | "Hatayı önce bul" vaadi; şablonlar ilk 30 dk hedefini sağlar | Kod gerektirmedi; erken bitiş sonuçları için [ADR-0047](adr/0047-early-exit-outcomes.md) önerildi |
| **3. Ölçülebilir etki** | F1, F2, F4; C4; D3; G1, G2 | İşe etkiyi sayıyla gösterme | [ADR-0048](adr/0048-sequential-ab-inference.md) (F1), [ADR-0049](adr/0049-canary-rollout-on-ab-assignments.md) (C4); D3 şema değişikliği gerektirmedi. **Uygulandı** (G2 kısmi: yalnız işleme kaydı) |
| **4. Akıllı katman** | A5/E1, E2, E3, E7; B2 | AI'ı sağlam veri ve yönetişim üzerine kurmak | E2 ve E7 uygulandı (model yok); A5/E1 ve E3 önceden API'de var, ek iş yok; B2 [ADR-0050](adr/0050-deterministic-session-replay.md) Proposed |
| **5. İleri işbirliği ve canlı AI** | C2, C3; E4, E5, E6; F3; D5, D6 (adım 30 ile) | En karmaşık; önceki dalgaların altyapısını kullanır | F3 (tavsiye) ve C3 (birleştirme önizlemesi) kısmen uygulandı; C2/C3 dal modeli [ADR-0051](adr/0051-suggestion-mode-and-branches.md), E4–E6/D5 [ADR-0052](adr/0052-live-agent-ai.md) Proposed; D5/D6 kısmen önceden var |

Her dalga sonunda: kullanılabilirlik testi (SUS), performans bütçesi raporu, [COMPETITIVE §3](COMPETITIVE.md#3-evaluation-plan) metriklerinin kendi ürün üzerinde ölçümü.

## 3. Başarı ölçütleri (Awaken ile eşleşmiş görevde doğrulanacak)

| Ölçüt | Hedef |
|---|---|
| 5 sayfa / 3 dal / 2 kaynaklı scripti oluşturma süresi | Awaken'ın ≤ ½'si |
| 3 kasıtlı hatayı bulma süresi | Awaken'ın ≤ ⅓'ü (B1+B3+A4) |
| Yeni tasarımcının ilk yayın süresi | ≤ 30 dk |
| Yeni ajanın eğitimsiz görev başarısı | ≥ %90 |
| SUS (tasarımcı ve ajan ayrı) | ≥ 85 |
| Pilot kampanyada AHT veya dönüşüm | İstatistiksel anlamlı iyileşme (F1 yöntemiyle) |

Bu ölçümler yapılmadan satış materyalinde "Awaken'dan iyi" denmez ([COMPETITIVE](COMPETITIVE.md) kuralı).

## 4. Sınırlar

- Her yeni domain mutasyonu audit olayı üretir; her UI metni i18n anahtarıdır; kural/AI çıktısı yalnız güvenli ifade motorunda çalışır (CLAUDE §1). Bu belgedeki hiçbir özellik bu kuralları gevşetmez.
- "ADR: evet" işaretli maddeler ADR kabul edilmeden koda geçmez.
