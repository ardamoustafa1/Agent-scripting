# KVKK veri envanteri ve aydınlatma/rıza uygulaması

Bu teknik envanter veri sorumlusunun hukuki değerlendirmesi ve VERBİS kayıt yükümlülüğü
kararı yerine geçmez. Tenant kendi veri sorumlusu kimliğini, amaçlarını, hukuki sebebini,
alıcıları, aktarımı, toplamayı ve ilgili kişi haklarını onaylı metne bağlamalıdır.
[Aydınlatma rehberi](https://www.kvkk.gov.tr/Icerik/5394/Aydinlatma-Yukumlulugunun-Yerine-Getirilmesi-Rehberi)
ve [aydınlatma/rıza ayrımı duyurusu](https://www.kvkk.gov.tr/Icerik/6765/AYDINLATMA-YUKUMLULUGUNUN-YERINE-GETIRILMESI-HAKKINDA-KAMUOYU-DUYURUSU)
esas alınır. Aydınlatma metni kabulü açık rıza olarak kaydedilmez.

| Veri grubu | Kaynak ve amaç | Saklama / koruma | Erişim ve silme |
|---|---|---|---|
| Agent kullanıcı kimliği, roller, IdP subject | SSO / yetkilendirme | Tenant RLS, BFF şifreli oturum, minimal claim | Tenant admin; revoke/SCIM/DSAR |
| ANI, müşteri profili, interaction attributes | Onaylı connector, script context | RuntimeCipher ile tenant/record bağlı AES-256-GCM | Scoped agent/supervisor; retention ve privacy workflow |
| `pii` / `pii:true` kalıcı değişkenler | Form/veri kaynağı, tenant'ın belirttiği amaç | Şifreli snapshot + şifreli Redis; plaintext default yasak | Script/session yetkisi; export/anonymize |
| PAN/CVV, kart track/PIN | PSP hosted capture | Verbis'te giriş alanı/saklama yok; PSP token verir | PSP sözleşmesi ve PCI kanıtı; receipt tek kullanımlık |
| Açık rıza tercihi | Ayrı `explicitConsent`, bilinçli seçim | Boolean bound variable; pinned ScriptVersion noticeVersion/purpose | Agent sadece müşteri seçimini kaydeder; false ile geri alma |
| Aydınlatma içeriği | `privacyNotice` ve onaylı i18n metin | Değişmez yayın sürümü + metin versiyonu | Designer/approver, yayın SoD |
| Session timing/outcome metadatası | Session events / ölçüm | Analytics strict allowlist; agent tenant HMAC pseudonym | Analytics permission, aggregate API |
| Audit aktör/işlem/zaman/hash | Mutasyon, erişim ve güvenlik izleme | Append-only zincir; redakte diff | Auditor; legal hold/retention |
| Notlar/transkript/veri kaynağı yanıtı | Agent/connector/integrasyon | Tenant policy, şifreli runtime; log body yasak | Amaç ve scoped permission; privacy workflow |
| AI girdi/çıktı | Tenant tarafından açılan öneri işlevi | PII masking, hash/audit, bölge/sağlayıcı politikası | İnsan onayı; sağlayıcı veri işleme sözleşmesi |

`privacyNotice` aydınlatma gösterir; `explicitConsent` ayrı, opsiyonel, ön seçimsiz
checkbox'tır. Script semantic validator true default veya expression ile ön seçim yapılmasını reddeder. Consent varsayılanı false olmalı, service gating için otomatik required
kuralı eklenmemelidir. Amaç ve noticeVersion yayınlanan dokümana bağlanır. Kanıt gerekiyorsa
bound boolean `persist:true` olarak yapılandırılır ve subject/session bağlamıyla korunur;
sadece UI checkbox olması tamamlanmış hukuki rıza kaydı anlamına gelmez. Geri alma ve
sonraki sistemlere etkisi tenant privacy workflow'uyla birlikte tasarlanmalıdır.

Retention süreleri tenant'ın hukuki sebebine göre seçilir; evrensel saklama süresi yoktur.
Üretim öncesi görevler: tüm DataSource alanlarını sınıflandırmak, önceki authoring PII
defaults'larını temizlemek, backup ve obje depolama silme kapsamını doğrulamak, alıcı/ülke
aktarımı envanterini ve saklama süresini onaylamak, ilgili kişi arama/export/anonimleştirme
ve rıza geri çekme zincirini sentetik verilerle doğrulamak. Agent pseudonym hâlâ kişisel
veri niteliğini taşıyabilir; anonim olduğu varsayılmaz. Her tenant envanterini bu tablonun
kendi veri kaynaklarına göre genişletmeli, güvenlik/uyum onayını audit'e kaydetmelidir.
