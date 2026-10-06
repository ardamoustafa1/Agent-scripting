# Veri erişimi ve farklılaştırıcılar — 2026-10-06

## Uygulanan kapsam

- **G-04:** API sertifika başlığını yalnız `x-verbis-mtls-proxy-secret` sabit-zamanlı doğrulamasıyla kabul eder. Sertifika forwarding açıkken en az 32 karakterlik sır zorunludur. Dev bootstrap bu sırrı üretir ve korur; dev mTLS edge sahte başlıkları değiştirir. Public nginx yolları sertifika ve proof başlıklarını siler. Helm private ingress operatörün yönettiği header map referansını kullanır. Sır yalnız edge/API içindir; worker/hub'a verilmez.
- **G-03:** Agent rolünden User okuma kaldırıldı. `/v1/users`, kullanıcı ayrıntısı ve grup listesi agent'a 403 döner; kendi `/v1/me/permissions` ve session/desktop akışları kullanılabilir.
- **M-Y1:** `role-scope` aynı rolün tüm etkin manual/claims/SCIM atamalarını günceller; ikinci manuel rol oluşturmaz. Tenant filtresi, grantability denetimi, versiyon kontrolü, audit ve outbox korunur. IdP login senkronizasyonu mevcut atamanın kapsamını korur; rol kaynakta kaldırılıp yeniden verilirse yeni atama varsayılan boş kapsamla başlar. Yönetici ekranında kapsam kaynağı açıklaması güncellendi ve rol seçimi tekilleştirildi.
- **R-X1:** SQL enum/migration, PostgreSQL salt-okunur ve parametreli named-query driver, outbound-only private gateway worker, şifreli/geçici Redis aktarımı ve mTLS client/tenant izolasyonu eklendi. Normal API SSRF kuralı özel IP erişimine açılmadı. [SQL ADR](../adr/0042-named-read-only-sql-connector.md), [gateway ADR](../adr/0043-outbound-private-egress-gateway.md), [kurulum](../integrations/PRIVATE_EGRESS.md).
- **G-09:** Sentetik PAN kanaryası ham giriş reddini ve imzalı hosted capture receipt başarı yolunu çalıştırır. PostgreSQL'in tüm public tabloları (audit/outbox/analytics dahil), Redis türleri, deşifre edilmiş runtime state/cache, tüm NATS stream mesajları, HTTP cevapları ve gerçek API logger çıktısı taranır. Analytics projection gerçekten çalıştırılır. Tarayıcı PSP/vendor PCI sertifikasyonu bu yerel testin kapsamı değildir.

## Öneri tablosundaki 10 özellik

Bu dilimde yukarıdaki somut değişiklikler uygulandı. Diğer önerilerin mevcut bileşenleri ve kalan ürün dilimleri aşağıda izlenir; tablo on yeni ürün özelliğinin tamamlandığı iddiası değildir.

| # | Özellik | Mevcut durum / bu dilim | Sonraki somut dilim ve kabul ölçütü |
|---|---|---|---|
| 1 | Yayın öncesi script testi | Release jobs, script validation ve publication gate mevcut; bu işte değiştirilmedi | Her yayın için sürüme bağlı sentetik çağrı senaryosu kanıtı; bozuk dal/servis/mustRead senaryosu yayını engellemeli |
| 2 | Mühürlü audit + müşteriye sertifika | Audit zinciri, checkpoint doğrulama ve export mevcut; yeni sertifika formatı uygulanmadı | İmzalı tenant/sıra aralığı/checkpoint/hash raporu; bağımsız CLI doğrulayıcı ve değiştirilmiş rapor reddi |
| 3 | PCI/kayıt durdurma kanıtı | Hosted receipt + PCI kanarya eklendi; recording command/connector yolları mevcut | PSP capture önce pause ACK, sonra resume ACK; gerçek vendor kayıt içeriği ve kanarya taraması birlikte kabul edilmeli |
| 4 | Canlı bozuk script önizleme/lint | Sunucu script validation ve preview service mevcut | Tasarımcıya node/path ile hata gösterimi; eksik bileşen/servis pininde önizleme ve yayın aynı hatayı vermeli |
| 5 | Çok oturumlu agent masaüstü | Mevcut desktop controller ve writer lease/devral sınırları | Kanal/müşteri etiketi ve iki sekmede devral testi; eski yazıcı komutu reddedilmeli |
| 6 | A/B ve outcome önerileri | Routing A/B ve analytics projections/reporting mevcut | Öneri üretimini doğrulanmış, yeterli örnekli outcome kohortlarına bağla; yetersiz/veri kaybı olan kohort öneri vermemeli |
| 7 | Private egress gateway | Bu dilimde outbound polling, tenant/client lease, RFC1918 CIDR/DNS pinning, HTTP ve SQL uygulandı | Müşteri ağında TLS/DNS/worker restart/yük kabulü; queue/worker health metriği ve güvenli concurrency |
| 8 | Yasal metin okuma kanıtı | `mustRead` ve `text.acknowledged` runtime/outbox yolu mevcut | Metin/sürüm/sayfa checksum'una bağlı zaman damgalı kanıt; metin değişince eski onay geçersiz olmalı |
| 9 | Ortak düzenleme + yorum/inceleme | Yjs/collaboration ve review bileşenleri mevcut | İki bağımsız browser kullanıcısıyla eşzamanlı edit, reconnect ve yorum/inceleme kabulü; canlı test skip olmamalı |
| 10 | Tenant bootstrap | Mevcut dev bootstrap ve demo seed mevcut | Üretim tenant'ına idempotent simülatör/kampanya/script onboarding job; ikinci çalıştırmada kopya kayıt ve otomatik onay yaratmamalı |

## Doğrulama

Yerel/izole fixture sonuçları:

| Kontrol | Sonuç |
|---|---|
| API unit (`vitest --project unit`) | **1656/1656**, 137 dosya, skip yok |
| API integration (api, gateway, OIDC, client-credentials, hub, launch, runtime) | **105/105**, 7 dosya, skip yok; PostgreSQL/Redis/NATS Testcontainers |
| Authz rol matrisi | **590/590** |
| Shared integration sözleşmeleri | **4/4** |
| Admin identity davranışı | **10/10** |
| Dev bootstrap + gerçek TLS proxy | **6/6** |
| Helm deployment | **8/8** |
| Docs/OpenAPI referansı | **4/4** |
| API, Designer, Admin typecheck | Geçti; app/node TS projeleri ayrıca kontrol edildi |
| Değişen API/authz/shared/i18n/admin/scripts lint | Geçti; eşikler gevşetilmedi |

[Sonuç özeti ve SHA-256](evidence/data-access-20261006/summary.json).
Ham Vitest raporları: `reports/data-access/api-unit.json`, `reports/data-access/api-integration.json`.
Üretim müşteri ağı, gerçek PSP, tarayıcı hosted-field entegrasyonu ve vendor recording ACK bu yerel
kanıtların kapsamı değildir. Varsayılan kapalı gateway'i açmadan önce migration, edge ortak sırrı,
dedicated service client, müşteri target/query catalog ve bağımsız database yetkileri provision edilmelidir.


## B takiplerinin ikinci kod dilimi — 2026-10-06

Yukarıdaki tablo ilk dilimin tarihsel durumudur. SQL Designer formu, zorunlu server
regression gate, imzalı audit sertifikası/bağımsız CLI, scoped outcome önerileri,
version/checksum-bound okuma kanıtı, lazy çok-session metadata ve idempotent tenant
onboarding eklendi. Kayıt ACK utility timeout/resume failure durumlarını korur; gerçek
PSP akışına entegrasyon ve vendor ACK kabulü açık. Müşteri ağı ve iki SSO browser
live collaboration kabulü açık. Güncel özellik bazında durum, sonuçlar ve sınırlar
[B_COMPLETION_2026-10-06](B_COMPLETION_2026-10-06.md) kaydındadır.
