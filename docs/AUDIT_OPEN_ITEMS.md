# Verbis — Denetim Raporu Açık İşler (2026-10-06)

Kaynak: [AUDIT_REPORT.md](AUDIT_REPORT.md) bulguları ile [PROGRESS.md](PROGRESS.md) ve `docs/verification/*2026-10-06*` kayıtlarının karşılaştırması.
Yöntem: her bulgu ID'si bu kayıtlarda aranmıştır. **Hiç anılmayan ID'ler "ele alınmadı" sayılır**; bu bir kod doğrulaması değil kayıt taramasıdır, bir ID anılmadan düzeltilmiş olabilir. Her oturumun başında ilgili satır kodda yeniden doğrulanmalıdır.
Olumlu kanıt satırları (G-01, G-02, G-05, G-06, G-08, K-06, U-08, D-03, D-06, D-14, D-18, D-22, D-24, D-30, D-34, D-37, D-38 vb.) kusur değildir ve listelenmemiştir.

## A. Bu oturumda uygulanan ve yerel kapılarla doğrulanan işler

Kullanıcının A tablosundaki kod kapsamı tamamlandı. Bulgu başına uygulama, regresyon ve
sınırlar [OPEN_ITEMS_2026-10-06](verification/OPEN_ITEMS_2026-10-06.md) kaydındadır.

| ID | Son davranış | Kanıt |
|---|---|---|
| D-16 | Designer tenant kaynağını belgeye sürüm pin/eşlemelerle bağlar; WebService seçim listesi kullanır. | Chromium autosave + gerçek API review/publish. |
| T-06 | Launch/authz/audit chain/SSRF/vault yolları %95 satır/%90 dal; merkezi kapı ve en az 1.000 property/fuzz denemesi zorunlu. | Unit/property + gerçek API kapsam raporları, eşik düşürülmedi. |
| M-14 | REST/WS özel tek oda sahibine yönlenir; çakışan debounce kopyası ve audit kalıcı transaction ile korunur, yetkili yeni taslak kurtarması vardır. | Gerçek PostgreSQL/Redis flush çatışması + tenant izolasyonu; ADR-0044. Yatay Yjs çoğaltma desteklenmez. |
| M-20 | Üç partial hot-path indeksinin migration/catalog/predicate ve optimizer uygunluğu doğrulanır. | Drift/idempotency/RLS + EXPLAIN. |
| T-17 | Varsayılan endpoint/key/OAuth/SOAP değerleri boş; örnek alan adları server save'de, test hostları production profilinde reddedilir. | UI/server authoring regresyonları; boş OAuth alanına yazma ve strict save korunur. |
| T-18 | Fake/test hub dosyaları üretim dist'inde yok, ürün templates modülü fixtures'dan ayrıdır. | Build artifact sınır testi CI'da da zorunlu. |
| M-21 | Bildirim metadata/review/assignment batch sorguları, screen batch projection. | 100 sürüm/200 mention sorgu sayısı ve projection regresyonu. |
| M-23 | Ortak health hook/secure types/connector factory, tek decode, runtime service ve doğrulanmış env. | Mevcut davranış/owner/writer güvenlik sözleşmeleri. |
| M-01 / M-02 | Gerçek render temel sözleşmeleri, koşullu metadata, core Embed ve kolon para birimi. | 69 bileşen runtime sözleşmesi, sandbox/message/URL/error/EUR testleri; ADR-0045. |
| D-02 / D-05 / D-21 / D-31 / D-32 | Yetki açıklaması, köke tıkla-ekle, adlı tek kaynak koşullar, kısa klavye yolları, tema/OS forced-colors. | Fail-first unit/e2e, axe/kontrast ve incelenmiş görsel baselinelar. |
| K-07 | Normal Agent/Designer JS chunk'ları 500.000 byte altında; ELK Auto Layout'ta ayrı worker. | Gerçek dist byte bütçesi; 1,59 MB on-demand worker ayrıca raporlanır. |
| T-14 / T-15 | Saklı rol kuralları zod ile doğrulanır (fail-closed); production'da `dev_only_change_me` yer tutucuları env doğrulamasında reddedilir. | Fail-first unit testler. |
| U-01 | Admin-web yeni `GET /auth/session/status` ile oturum yokken 401 yerine 200 `{authenticated:false}` alır; eski uç değişmedi. Agent/designer hâlâ eski ucu kullanır. | Unit + admin Chromium e2e 50/50. |

## B. Kod dilimi uygulandı; dış kabul ve kullanıcı kapsamı ayrı

2026-10-06 B takipleri kod üzerinde yeniden incelendi, eksikler uygulandı ve yerel
kapılar yeniden koşuldu. Bulgu bazında davranış, testler ve sınırlar:
[B_COMPLETION_2026-10-06](verification/B_COMPLETION_2026-10-06.md).

| Kapsam | Son durum |
|---|---|
| K-01 / T-11 / T-12 / T-13 / T-02 | **Kullanıcı kapsam dışı bıraktı: “repo işini yapma”.** Commit/push/remote/branch protection/uzak CI yapılmadı; yerel başarı uzak CI kanıtı değildir. |
| Grup 8: M-25…M-28 | AXP token/wrap-up, Finesse UTF-8 40 byte, Flex If-Match, OCS distribute event, AACC mTLS/subscription/imza kodları ve yerel sözleşmeler mevcut. **Sekiz vendor gerçek SDK/lisans ve canlı kabul açık.** |
| T-09 ve DLQ | JTAPI/PSDK signature-stub yerel compile geçti; gerçek SDK uyumluluğu değildir. Yetkili DLQ replay UI/CSRF/onay ve `connector.deadletter.replayed` audit uygulandı. |
| Grup 9 | P-18, D-01/D-04/D-08/D-09/D-12/D-13/D-15/D-17/D-19/D-20/D-25/D-26/D-27/D-29 için kod/regresyonlar; lokasyon kataloğu ve named scope picker. P-13 25 session fixture'da **1 desktop/1 attach**, aktif tab hydration; müşteri label disclosure yetki/audit altında. |
| D-36 | Bağlantı başarısızlığında REST düzenlemeyi koruyan deadline/auth recovery, dev port/proxy. **İki ayrı SSO browser ile live edit/reconnect/yorum kabulü açık.** |
| Grup 10 | SQL Designer formu; server regression gate; imzalı audit sertifikası + bağımsız CLI; scoped outcome önerileri; version/checksum-bound read evidence; idempotent tenant onboarding ve çok-session UI uygulandı. **Gerçek PSP akışına guard entegrasyonu/vendor recording ACK ve müşteri ağı kabulü açık.** |
| Grup 3 | Immutable DataSourceVersion snapshots, RLS/hash/append-only trigger, immutable key; runtime/validation/package tarihsel pin kullanır. Daha önce saklanmayan eski içerik geri üretilemez; eksik pin reddedilir. Farklı pinlerin package dependency'si birbirini ezemez. |
| Grup 6: M-15 | Yjs update başına 2 MiB + oluşan belge/frame sınırı; oversized update reddi. |
| K-04 | Geçmiş 12 lint hatası tarihsel kayıttır. Son yerel root lint/typecheck/build/test/coverage/Chromium sonuçları B doğrulama kaydı ve SHA-256 özette izlenir. |

## C. Dış erişim bekleyenler (kod işi değil)

Gerçek vendor ortamı (Genesys sandbox dahil), canlı SAML/SCIM, PCI uçtan uca + QSA, wrap-up geri yazımı, gerçek PSP, staging'de 2.000 oturum yükü, restore RPO/RTO, bağımsız pentest, Awaken ile karşılıklı görev ölçümü, canlı AI asistan (lisans/kapsam kararı).

## D. Sonraki kabul sırası

1. Gerçek vendor SDK/lisans ve sandbox erişimi ile M-25…M-28/T-09 kabulü; stub derlemesi gerçek SDK kanıtı sayılmaz.
2. Gerçek PSP capture akışına pause/resume ACK guard entegrasyonu ve vendor recording içeriği/PCI kanaryası kabulü.
3. Ayrı iki sentetik SSO kullanıcısı ile live collaboration, reconnect ve yorum/inceleme kabulü.
4. Müşteri ağında private egress gateway TLS/DNS/restart/yük ve staging 2.000 oturum kabulü.
5. Tek oda sahibi dışına ölçeklenmeden önce ADR-0044 HA/ownership sınırları doğrulanmalı.

Repo/uzak CI işleri kullanıcı isteğiyle bu çalışma kapsamında yapılmayacak.
