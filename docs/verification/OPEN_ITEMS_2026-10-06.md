# A bölümündeki açık işler — 2026-10-06

Kapsam: kullanıcı tarafından istenen D-16, T-06, M-14, M-20, T-17,
T-18, M-21, M-23, M-01, M-02, D-02, D-05, D-21, D-31, D-32 ve K-07.
Önceki veri erişimi ve UX değişiklikleri korunmuştur. Aşağıdaki kanıtlar yereldir;
uzak Git/branch protection/CI run URL bu çalışma alanında yoktur.

| ID | Uygulanan davranış | Doğrulama |
|---|---|---|
| D-16 | Yetkili taslak editöründe tenant veri kaynağı seçimi, sayfalama, sürüm pini, giriş/çıkış eşlemeleri, zaman aşımı; kullanılan kaynağın silinmesi engellenir. WebService kaynağı serbest metin yerine belge içindeki bağlardan seçilir. | Chromium seç → `document.dataSources` + `props.ds` → autosave/schema/semantics; gerçek API source catalog → review → publish. Unit testler eşleme, düzenleme politikası, duplicate, bozuk JSON, timeout, yükleme hatası ve askıya alınmış yazmayı sınar. |
| T-06 | API launch/authz/audit-chain/audit-repository/SSRF HTTP/IdP/vault yollarına %95 satır ve %90 dal kapısı. Merkezi kapsam kapısı eksik raporu reddeder; expression engine %95 korunur. Güvenlik property/fuzz seçenekleri en az 1.000 deneme ve sabit seed gerektirir. | Launch denial, BFF/mTLS/routing/redeem sınırları; audit SQL bind/cursor; vault bozuk/eksik/aşırı büyük/deadline cevapları; authz/audit-chain/SSRF/expr property testleri. Kapılar düşürülmedi. |
| M-14 | Oda REST ve WS yolları tek özel collaboration sahibine gider; Helm ikinci oda sahibi/rolling overlap/autoscaling'i reddeder. REST sürüm çakışmasında debounce Yjs kopyası ve audit aynı tenant transaction'ında saklanır; oda donar. Yetkili Designer kopyayı açıp yeni taslak oluşturabilir. | Gerçek PostgreSQL/Redis flush çakışması, Yjs byte kurtarma, tek kopya/tek audit, başka tenant reddi ve yeni REST taslağının korunması. Proxy/Helm regresyonu, client başarılı/başarısız recovery save testleri. [ADR-0044](../adr/0044-single-room-owner-and-conflict-recovery.md). |
| M-20 | Mevcut `sessions(tenant_id,state)`, `sessions(tenant_id,interaction_id)` ve assignments tenant/script partial indeksleri migration/catalog ile doğrulanır. | PostgreSQL migration idempotency/drift/RLS; indeks predicate envanteri ve `EXPLAIN` index eligibility. Küçük fixture tablosunda seqscan kapatılır; bu test bir üretim gecikme ölçümü değildir. |
| T-17 | Yeni integration key/baseUrl/OAuth token URL/SOAP namespace-operation boş başlar. Örnek URL yalnız placeholder olur; documentation domains hiçbir ortamda kaydedilemez, production etkin profilinde `.test/.invalid/.localhost` de reddedilir. Named SQL tanımı URL denetiminden ayrı tutulur. | Editör ve gerçek server authoring regresyonları; base/profile/OAuth reserved host testleri, üretim approval kontrolü. |
| T-18 | Hub temiz derleme `src/test/**` ve `*-test.ts` sevk etmez; ürün script şablonları bağımsız `templates/` modülündedir. | Gerçek `dist` dosyalarında fake/test taşıyıcıları yok; ürün importu broken/legacy fixture modülüne gitmez. CI build sonrası artifact kapısı. |
| M-21 | Bildirim atamaları/review'lar/sürümler toplu metadata sorguları; sayfa projeksiyonu `createManyAndReturn`. | 100 review sürümü + 200 mention için sabit sorgu sayısı; projection mapping regresyonu. |
| M-23 | Ortak API health hook, güvenli giriş tip kümesi, marketplace sınıf factory'si; integration belgesi tek decode; runtime datasource iş kuralı ince controller'dan service'e alındı; ortam doğrulanmış env'den gelir. | Health hook, connector sözleşmeleri, runtime owner/writer/sequence fence ve integration unit/gerçek API testleri. |
| M-01 | `builtOn` kategoriden tahmin edilmez; koşullu Button temeli ayrıca belirtilir. Form kontrolü sınırı ADR'de açıkça tanımlıdır. | 69 library bileşeni gerçek Runtime/DOM ile Box ve veri bileşenlerinde WebService temeli için sözleşme testinden geçer. [ADR-0045](../adr/0045-library-foundations-and-embed-boundary.md). |
| M-02 | Core Embed HTTPS/origin/credential/sandbox/alt/captions/error zarfını merkezileştirir; hosted PCI mesajı origin + gerçek frame window ile doğrulanır ve abonelik temizlenir. Veri tablosu kolon para birimini kullanır. | Core embed URL/sandbox/message/unsubscribe regresyonları, media/secure-input ve EUR format testi. |
| D-02 | Kampanya atama yazma yetkisi olmayan kullanıcı için Kaydet'in neden kullanılamadığı TR/EN açıklanır. | Önce kırmızı yetki regresyonu; POST yapılmadığı doğrulanır. |
| D-05 | Palet tıkla-ekle sayfa köküne ekler; sürüklemede kapsayıcı seçilir. Hedef davranışı palet metninde açıklanır. | Ardışık Box/Card eklemeleri kardeş kalır; e2e kaydedilmiş hiyerarşi kontrolü. |
| D-21 | Görünürlük/etkinlik/zorunluluk adlı fieldset; tek görsel/expression kaynağı, ayrı referans seçimi. Literal true/false advanced uyarısı üretmez; boolean değeri seçilebilir. Routing expression yasağı korunur. | Inspector/flow/rule builder regresyonları; true/false ve negated boolean kontrolleri. |
| D-31 | Palet ve kanvasa atlama, palet öğesinde tek Tab durağı, adlı taşıma tutamağı; Shift+Space sürükleme, canvas Home/End/ok seçimi ve Alt+ok sıralama; ayrıntılı yerel yardım. | Gerçek Chromium klavye yolu ve store/DOM unit regresyonu; çocuk input'un okları ele geçirilmez, askıdaki yazma sıralamayı değiştirmez. |
| D-32 | React Flow kontrol/minimap/edge token stilleri; preview tema eşleşmesi; OS forced-colors'ta sistem ve marka token'ları okunabilir kalır. | Açık/koyu/HC × mobil/desktop axe; ikon kontrastı ≥3:1, attribution ≥4.5:1; forced colors axe; incelenmiş görsel baselinelar. |
| K-07 | Vite 8/Rolldown bağımlılık ve workspace grupları; expression/flow/chart modülleri bölünür, ELK yalnız Auto Layout sırasında ayrı worker'dır. 500.000 byte JS chunk bütçesi CI'da gerçek build çıktısını kontrol eder. | Agent 18 normal chunk, en büyük 408.358 byte; Designer 102 normal chunk, en büyük yaklaşık 163.026 byte. ELK worker 1.593.716 byte ve ayrı istek: normal chunk bütçesine dahil edilmediği açıkça raporlanır; entry/static import olması reddedilir. |

M-14 yatay Yjs replikasyonu iddiası taşımaz: bir oda sahibi desteklenir, normal API pod'ları
ayrı ölçeklenir. Başarılı conflict commit'inden önce hard kill veya DB erişim kaybında
onaylanmamış edit kaybı riski ADR'de kayıtlıdır. Recovery rows append-only ve forced RLS
altındadır; uygulama rolünde yalnız SELECT/INSERT vardır. Operatör retention/backup uygular.

Görsel baz çizgileri yeni veri kaynağı komutu ve klavye tutamağı düzeninden dolayı değişti.
Açık/koyu desktop, yüksek kontrast mobile ve fullscreen gerçek PNG'ler görsel olarak
incelendi; overflow, axe ve kontrol çakışma assertion'ları korunarak yalnız ilgili 12 görüntü
yenilendi. Kanıt: `evidence/open-items-20261006/`.

## Son yerel kalite kapıları

- Root `pnpm lint`: **33/33**, `pnpm typecheck`: **32/32**, `pnpm build`: **19/19**.
- Son root `pnpm test`: **32/32 görev**, **29 cache hit**. API **2.002/2.002**, Designer **392/392**, Agent **153/153**, Admin **120/120**, components **369/369**, core-runtime **134/134**, UI **116/116**. Hub **653 geçti / 4 opt-in Genesys sandbox testi atlandı**; canlı sandbox çalıştırılmış sayılmadı.
- Merkezi kapsam kapısı **18 workspace**, hata **0**. Launch satır/dal **%99,46/%94,14**; authz **%99,51/%90,84**; audit-chain core **%99,50/%95,35**; audit repository **%100/%100**; SSRF transport **%100/%94,12**; IdP HTTP **%100/%96,88**; vault **%100/%100**, transit **%100/%96,30**. Designer genel dal **%81,48**, editör **%81,33**, rules **%80,11**; eşikler değişmedi.
- Format, test harness typecheck/lint, `git diff --check` temiz. Audit/i18n kapısı **3/3**; **1.967 TR / 1.967 EN** anahtar, eksik literal anahtar **0**. Policy **54/54**, artifact **2/2**, deployment **12/12**, Helm lint/render ve Compose + rendered Helm Nginx syntax geçer.
- Hub temiz yeniden derlemesi ve artifact kapısı da geçti; eski dist test yardımcıları kalmaz.
- Tam Chromium/axe: **23/23 görev**, Designer **260/260**, Admin **48/48**, Agent **37/37**, Docs **12/12**. Dört uygulamada atlanan, başarısız veya flaky test **0**. Bu fixture tabanlı Chromium kabulüdür; canlı vendor/staging testi değildir.
- Son loglar, kapsam JSON’u, Chromium özetleri, incelenmiş PNG’ler ve SHA-256 dosya envanteri: [kanıt dizini](evidence/open-items-20261006/README.md).

Ara başarısızlıklar başarılı sonuç olarak sayılmaz. İlk tam turdaki eski beklentiler/kapsam
boşlukları, reserved endpoint kaydı ve audit olay adı regresyonlarla düzeltildi. Paralel build/test
Prisma generation EEXIST ve değişen dist üzerinde 404 ürettiği için final lint → typecheck →
build → test → e2e sıralı koşuldu. Admin görsel testi tüm gerçek fixture cevapları görünmeden
fotoğraf alıyordu; artık readiness, outbox ve operation sonuçlarını bekler, screenshot bütçesi
ve baseline toleransı değişmedi.

Canlı vendor/PSP/staging ve uzak CI, A tablosunun kod kabulünden ayrı dış kabul adımlarıdır.
