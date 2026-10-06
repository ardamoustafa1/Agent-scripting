# Verbis / Awaken Agent Guidance — güncel scripting kıyası

Tarih: 2026-10-05. Karar: **Genel üstünlük kanıtlanmış değildir.** Verbis çekirdek scripting konusunda ciddi bir alternatif ve bazı mühendislik özellikleri güçlü farklılaşma adaylarıdır. Rakibin aynı görevlerde ölçümü yoktur. Özellik sayısı, kendi test sayımız veya tasarım beğenisi rekabet üstünlüğü skoru değildir.

## Kapsam

Karşılaştırılan ürün Awaken Intelligent Agent/CallScripter/Synergy çizgisinin güncel Creovai Agent Guidance ürünü; AwakenWorks adlı ayrı yazılım değildir. Üreticinin [giriş belgesi](https://docs.awaken.io/ag/core/introduction.html) ad değişikliğini doğrular. Agent Assist ayrı lisans gerektirebilir; çekirdek scripting ile AI ürün ailesi aynı paket varsayılmaz.

Rakip için güncel resmi dokümanlar okundu; çalışan demo/tenant üzerinde eşit görev ölçümü yapılmadı. Belge bir yeteneğin beyanını gösterir, kalitesini/latency/SLA veya müşteri kabulünü ölçmez. Belgede bulamadığımız özelliği rakipte yok olarak işaretlemiyoruz.

Verbis için güncel kaynak ve son iki gerçek tarayıcı denetimi, izole gerçek API/hub/DB oturum kabulü kullanıldı. Önceki raporlardaki farklı tarihsellik/koşu durumları tek toplam halinde birleştirilmedi. Bu tur production uygulama değişikliği yapılmadı.

## Karşılaştırma matrisi

| Alan | Awaken resmi kanıtı | Verbis gözlenen kanıtı | Hüküm |
|---|---|---|---|
| Görsel editör / sayfalar / alanlar | [Designer](https://docs.awaken.io/ag/core/designer.html): sayfa ve alanlar, clipboard, ortamlar, stil, değişkenler, arama. | Ekran/akış/kural/değişken modları, undo/redo/gruplama, arama; 72 palet ekleme tek tek denendi. | Temel kapsam iki tarafta. Eklenen bileşen sayısı işlev derinliği ve tasarım hızı üstünlüğü değildir. |
| Kurallar / koşullu akış | Designer ve [Check/Preview](https://docs.awaken.io/ag/core/checking_and_previewing_workflows.html) navigation/code kontrollerini belgeler. [Message JS](https://docs.awaken.io/ag/core/sending_messages_with_javascript.html) özelleştirme örneği. | Görsel akış ve kural builder, sandbox expression, veri/alt akış sözleşmeleri. | Bizim güvenli ifade modeli yönetim avantajı adayı; onların JS esnekliği de fayda olabilir. Aynı karmaşık görevin çözüm ve hata oranı ölçülmedi. |
| Preview / teşhis | Check Workflow+agent-benzeri preview; belge external link/campaign data sınırını açıklar. | Step/watch/breakpoint/I-O, mock/live-source seçimi ve redaction. | Bizde güçlü teşhis aracı doğrulanmış. Rakibin debugger eşdeğerinin tamamı incelenmedi; kesin üstünlük yok. |
| Kaydedilmiş test / regresyon | İncelenen Check/Preview sayfası manuel preview ve yapısal kontrolleri gösterir. | Sentetik senaryo kaydı+assertions+sunucu regression; gerçek QA dört senaryo4/4. | En iyi farklılaşma adaylarımızdan biri. Rakibin otomasyon/test eklentileri demo ile doğrulanmalı. |
| Tekrar kullanım / şablon | Designer linked Used Fields ile değişikliğin diğer örneklere yansımasını belgeler. | Sürüme sabitlenen ortak ekranlar, şablon galerisi, tenant template ve bağımsız türetme gerçek UI’da geçti. | Alan paylaşımı ile ekran paylaşımı farklı granülerlik; iki tarafta reuse var. Used Field’in bütün davranışlarına eşdeğer kabul yok. |
| Sürüm / yayın / yönetim | Designer workflow/version edit ve Publish içerir. | Structural diff, immutable version/pin/checksum, ayrı review/publish, rollback kaynak/testleri; izole gerçek yayında ayrı kullanıcı onayı geçti. | Verbis izlenebilir değişiklik yönetiminde güçlü. Awaken’ın bütün enterprise workflow policies görülmeden “onlarda onay yok” denemez. |
| Ortak düzenleme | İncelenen resmi sayfalar aynı iki yazarlı CRDT davranışını kesinleştirmedi. | Yjs/presence/flush; önceki geniş denetimde tekrarlayan hata vardı. Bu tur yeniden koşulan tam ürün sonucu aşağıda. | Potansiyel farklılaşma. Tek case sonucu bütün reconnect/node-loss/çok kişi kabulü değildir. |
| Aktif Agent runtime | [Campaigns](https://docs.awaken.io/ag/core/campaigns_section.html) published workflow delivery; [Genesys workflow](https://docs.awaken.io/ag/core/workflow_design_for_genesys_cloud.html) interaction lifecycle/outcomes. | Gerçek simulator→mTLS→launch→iki sayfa→persist→recording/hold/resume→outcome→hub ACK üç motor3/3. İkinci sekme read-only. | Çekirdek runtime yerel kabulü geçti. Gerçek vendor acceptance ayrı açık. |
| Operasyonel desktop | [Desktop settings](https://docs.awaken.io/ag/core/desktop_settings.html): FAQ, desktop tabs, transfer/reschedule/task notifications. | Multiinteraction yapı, knowledge/transferHint/callback bileşenleri ve host capability tests. | Bileşen varlığı gerçek transfer/dialer/task lifecycle eşdeğerliği değildir. Awaken’ın belgelenen operasyon detayları benchmark kapsamına alınmalı. |
| Entegrasyonlar | [Integrations](https://docs.awaken.io/ag/core/integrations.html): Genesys Cloud/PureConnect/PureEngage/8x8/Cirrus, SQL/MySQL, generic/Cloud API. | Contract+adapter kaynakları, REST/SOAP/GraphQL proxy, schema/mapping/mock, generic hub gerçek yerel kabul. | Bizim abstraction geniş; lisanslı vendor uçlarında kabul yok. Belgelenmiş vendor kapsamını kod sayısıyla geçtiğimiz iddia edilmez. |
| SSO / SCIM | [SCIM](https://docs.awaken.io/ag/core/integration___scim_provisioning.html) merkezi user/group ve SCIM2.0; integrations SSO’yu listeler. | OIDC/SAML/SCIM kaynak/testleri, BFF/tenant authz. | Standart kurumsal özellikler; tek başına farklılaştırıcı değil. Müşteri IdP lifecycle kabulü ayrı. |
| Launch security | [URL GET popping](https://docs.awaken.io/ag/core/url_popping___get.html): campaign/reference params, opsiyonel credentials veya SSO; SSO-only credentials’ı reddeder. [Cloud API](https://docs.awaken.io/ag/core/integration___cloud_api.html) asynchronous pop sınırlarını belirtir. | Kısa TTL, hash-only opaque single-use code, user/tenant/interaction binding; gerçek runtime ve ikinci yazar sınırı. | Somut farklı güvenlik tasarımı. Belgelere dayanarak bütün Awaken kurulumları güvensiz denmez. |
| Audit / gizlilik | İncelenen kaynaklardan aynı hash-chain/WORM threat model kesinleştirilemedi. | Hash-chain/signature kontrolü gerçek server checked168 valid; masking ve server secret isolation. | Güçlü testli aday. Rakibin eşdeğeri bilinmiyor; bağımsız pentest/compliance sertifikası yerine geçmez. |
| UX / erişilebilirlik | Designer’da çalışma alanı panelleri var; aynı görev/a11y ölçümü yok. | Sidebar collapse/fullscreen, responsive light/dark/high-contrast ve axe testleri. Son audit5bug düzeltildi. | Profesyonel altyapı ilerledi; operasyon kullanıcısının görev süresi/hata/öğrenme ölçümü yok. |
| Performans | Aynı topology/workload/budget ölçümü sağlanmadı. | Son yerel navigasyon250–831ms; tekrar279–467ms; geçiş17–27ms. Audit26.411event/s. | Kendi sınırlarımız geçti; rakipten hızlı veya2000agent kapasitesi kanıtı değil. |
| AI (ayrı kapsam) | [Agent Assist](https://docs.awaken.io/ag/core/integration___agent_assist.html), [Studio](https://docs.awaken.io/ag/core/agent_assist_studio.html): transcription, intent/category, summary/Q&A ve workflow actions. | Tasarım asistanı guardrails/katalog ve kapalı tenant UI; canlı AI bu kullanıcı kapsamında doğrulanmadı. | Belgelenen konuşma-AI ürün kapsamı Awaken/Creovai tarafında daha geniş. Sadece çekirdek scripting kararına otomatik eksi/arti puan eklenmez. |
| Operasyon / fiyat / iş sonucu | Aynı deployment/SLA/teklif ve karşılıklı pilot yok. | Yerel nginx security1/1; dağıtık HA/restore/load/staging açık. | AHT/FCR/conversion/TCO/uptime genel üstünlüğü ölçülemez. |

## Kanıtların güncel durumu

Studio351 unit, Admin101, Agent126, i18n7; normal Chromium224/22/28+2skip önceki tam denetimin kayıtlarıdır. Sonraki kalan-kabul turunda gerçek üç motor runtime3/3, nginxsecurity1/1, auditperf2/2 ve focusedsecurity44/44. Sayılar birbirinin yerine geçmez ve rakip performansı/kalitesi hakkında veri sağlamaz.

**Bu tur taze gerçek ürün matrisi:44 başarılı/1 başarısız, toplam45;81,69s.** Yeni isolated API/DB/BFF browser koşusu bütün kapsamıyla çalıştırıldı. Başarısız vaka iki distinct kullanıcı ortak düzenlemesi: peer `Synthetic peer update` yazdıktan sonra ilk kullanıcının description alanı5s içinde güncellenmedi, `Synthetic shared rule` kaldı. Mevcut convergence bütçesi korunur. Bu görünür senkronizasyon başarısızlığı kanıtıdır; tek başına kalıcı DB veri kaybı ispatı değildir. Full-run logu ve iki failure screenshot saklandı. Ortak düzenleme güvenilirliği P1 açık; üstünlük veya release kabulü olarak kullanılamaz.

Önceki Awaken full audit ortak düzenlemenin tam matriste başarısız olduğunu kaydetmişti. Eski genel raporun durumunu silmek yerine bu turun güncel sonucu ayrı kaydedilir. Bizim müşteriye satış açısından en büyük eksik kanıtlarımız: lisanslı telefon platformunda gerçek uçtan uca lifecycle; temsilci ve tasarımcı usability pilotu; müşterinin IdP/güvenlik ve gerçek staging load/HA/restore kabulü. Daha fazla test sayısı tek başına bunları kapatmaz.

## Rakiple yapılması gereken eşit görevler

| Görev | Ölçüm | Karar yöntemi |
|---|---|---|
| 5 sayfa / 3 dal / 2 datasource / zorunlu metin ve outcome | Bitirme süresi, yardım ihtiyacı, hata ve yanlış yönlendirme | Aynı brief/data, eşit eğitim; farklı kullanıcılar ve görev sırası dengelenir. |
| 3 kasıtlı hata bulma (yanlış branch/mapping/required) | Teşhis+onarım süresi, yeniden ortaya çıkış | Verbis regression/debugger avantajı burada ölçülür. |
| İki tasarımcı eşzamanlı edit+reconnect+publish | Veri kaybı, convergence, persisted diff, onay | Aynı çakışma/hata senaryosu; rakibin desteklenen yöntemi kullanılır. |
| Genesys Cloud gelen çağrı+hold/transfer/reconnect/outcome | Duplicate pop, yanlış user, note/code kaybı, ACK | Yetkili vendor sandbox, aynı campaign/account rules. |
| 30 temsilciyle kontrollü görev/pilot | AHT, FCR, uyum, işlem hata oranı, eğitim süresi | Pilot örnek boyutu istatistik planıyla belirlenir;30 otomatik yeterlilik garantisi değil. |
| Aynı edge/dataset ile karma yük | p50/p95/p99 render/launch/writeback, hata/recovery | Load hedefi/SLA önceden belirlenir; tek makine tek oturum kullanılamaz. |
| Aynı lisans ve entegrasyon kapsamı | 3yıl TCO, bakım/destek/SLA | Yazılı teklifler ve operasyon saatleri; public prices tahmin edilmez. |

Rakip demo/trial erişimi olmadan çift taraflı benchmark yapılamaz. Bugün doğru konumlandırma: testli, güvenli ve regression odaklı çekirdek scripting alternatifi; Awaken’dan genel olarak daha iyi olduğumuz iddiası değil.
