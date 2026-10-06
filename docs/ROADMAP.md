# Yayın riskleri ve önerilen yol haritası

2026-10-03: Denetim raporu/kod işi tamamlandı; **ürün GA kabulü açık**. Hiçbir test, load,
seed, migration veya browser kabulü bu denetim oturumunda çalıştırılmadı. Kaynak:
[FINAL_AUDIT](FINAL_AUDIT.md), tarihsel [PROGRESS](PROGRESS.md), ops/connector/security/ADR belgeleri.

## Önce kabul, sonra genişleme

| Öncelik | Eksik / risk | Somut kapanış ölçütü | Sorumlu alan |
| --- | --- | --- | --- |
| P0 | Özgün Prompt 0 listesi yok; CLAUDE ilk 11 geçici eşleme | Özgün 11 gereksinimi rapor satırlarıyla birebir bağla | Product / audit |
| P0 | Tüm test/coverage/mutation/e2e sonuçları yok | Gerçek CI raporları; packages 90/API 85/kritik UI 80, kritik güvenlik floor korunur; surviving mutant incelemesi | QA / maintainers |
| P0 | URL/launch/tenant/participant/replay/CSRF saldırı kabulü yok | İki tenant ve farklı role/participant ile tüm security suite; sıfır açık high/critical | Security / runtime |
| P0 | Audit AST reachability branch ve transaction kanıtı değil | Her route’un success/denied/failure fixture’ı; DB mutasyonu + audit rollback, scoped actor/diff; outbox/NATS/SIEM delivery | API / security |
| P0 | Dış connector/Redis etkileri DB commit ile atomik değil | Command outbox + durable idempotency/reconciliation; failed audit/commit sonrası external effect testi | Connector / API |
| P0 | OIDC/SAML gerçek browser, SLO/rotation/cookie kabulü yok | Keycloak ve hedef IdP’ler; signed SAML/unsigned/XXE/replay, logout/deprovision tests | Identity |
| P0 | V6.4.2: KEK/keyring uygulama belleğinde | Async Vault/HSM transit crypto boundary, ADR, rotation/failure/recovery tests; env injection yeterli değil | Security / platform |
| P0 | Vendor facade / lisanslı SDK / Java build kabulü yok | Hedef sürümde native bindings, lisanslı artefact provenance, ortak contract + gerçek sandbox matrix | Integrations |
| P0 | axe/manual AT/visual reference yok | Light/dark/high-contrast/RTL, loaded/empty/error/dialog/drag/plugin tüm states; reviewed Linux baseline + NVDA/VoiceOver | Frontend / QA |
| P0 | Load/SLO/Lighthouse ölçümü yok | k6 5.000 agent/100k-hour ×5 page/3 service + Socket.IO soak; p95/RUM ve RED ölçümü, performance ≥95 / accessibility 100 | Performance / ops |
| P0 | Gerçek clean-install smoke yapılmadı | İzole empty DB + IdP/mTLS fixture; installer + OIDC smoke; approval/SAML/collab live suites ayrıca | Release / QA |
| P0 | Production ingress/BFF/frame/CSP/TLS secret & telemetry topology | Hedef ingress’de /api, websocket, /telemetry, exact embedding origins ve mTLS spoofing negatif kabulü | Platform |
| P0 | Image/signing/offline/cluster policy uygulanmış değil | Digest/SBOM/provenance/cosign, offline import, ESO/NetworkPolicy/probe/HPA/PDB cluster acceptance | Platform |
| P0 | Backup/PITR/WORM/restore RPO/RTO kanıtı yok | İzole restore drill, key versions + audit-chain verification, ölçülen RPO/RTO, operatör imzalı rapor | Ops / security |
| P1 | Hub/document rooms single-owner; otomatik failover yok | Leader fencing, disjoint shard drain, durable command checkpoints, distributed Yjs relay/replay; node-loss test | Platform / collab |
| P1 | Redis doğrudan Sentinel discovery / sharded Cluster desteği yok | Desteklenen writable-primary endpoint topolojisi veya explicit adapter + failover acceptance | Platform |
| P1 | Tam cross-system DSAR/erasure/purpose/retention tamamlanmadı | Archive/CRM/object/analytics süreçleri, legal hold/retention workers, tenant home-cell/purpose ABAC kanıtı | Privacy / API |
| P1 | Compliance-ready sertifikasyon/üstünlük değildir | Counsel/DPIA/KVKK/GDPR/PCI scope/AOC incelemesi ve bağımsız ASVS/pentest | Security / legal |
| P1 | Agent storage commit öncesi mutlak sıfır kayıp garantisi yok | Durability budget + crash/eviction/reload tests; cross-BFF-session recovery policy; offline cold-start design | Agent |
| P1 | Debugger gerçek I/O/timer continuation replay değil | Approved/redacted event replay model, provenance, cancellation-safe deterministic continuation ADR | Runtime / designer |
| P1 | Component SDK production host approval/entitlement acceptance | Server catalog/publisher/tenant authorization, revocation/expiry/integrity/a11y plugin end-to-end | SDK / API |
| P1 | AI external local recognizer / provider acceptance | NER recall/PII leak benchmark, model residency/operator attestation, quota crash/usage reconciliation, human review | AI / security |
| P1 | Omnichannel capability derinliği sınırlı | Her vendor kanalına ayrı body/attachment/send/transfer/recording matrix; unsupported alanları kapalı tut | Connector / agent |
| P1 | Analytics scale/backfill/offline/OData sınırlı | Warehouse preaggregation, historical backfill, crash-idempotent SMTP schedule, bounded OData interoperability tests | Analytics |
| P1 | SCIM Bulk/conformance ve claim-scope mapping eksik | Entra/Okta validators + Bulk ADR/atomicity semantics + least-privilege claim scope tests | Identity |
| P1 | SOAP remote WSDL/1.2 ve gerçek mTLS sandbox sınırlı | SSRF/XXE korumasını koruyan explicit compatibility matrix, retry/idempotency/effect kabulü | Integrations |
| P1 | Geniş tenant/publisher listeleri ve scheduled purge işleri | Tenant pagination >500; scheduled idempotency expiry; secure memory purge notifications | API |
| P2 | Agent renderer / editor chunk ve runtime perf bütçeleri | Yetkili fixture ile before/after ölçüm; daha küçük lazy chunks, DB EXPLAIN, cache/pool/N+1 gerekçeli değişiklik | Performance |
| P2 | Çok bölge/tenant routing yalnız deployment seçenekleri | Audited home-cell migration/export-import, KMS/backup/egress isolation; active-active yazma ayrı ADR | Platform |
| P2 | Docs gerçek screenshot’ları yok | Sentetik SSO ortamında capture/review; şemaları gerçek step görselleriyle değiştir | Documentation |
| P2 | Rakiplere göre hız/AHT/onboarding üstünlük ölçümü yok | Aynı görev/dataset/hardware üzerinde timed evaluation/pilot; istatistiksel inceleme | Product |

## Önerilen sıralama

1. Tek gerçek vendor + tek bölge + sınırlı kanal için pilot scope’u sabitleyin. P0 test/SSO/launch,
   audit, a11y, image/ingress ve restore kanıtlarını toplayın. İlgisiz özellikleri mevcut flags ile kapalı tutun.
2. Ölçülen ilk k6/RUM/EXPLAIN sonuçlarına göre bottleneck düzeltin. Varsayımla yeni cache/index
   eklemek veya pools’u büyütmek kabul sonucu değildir. Queue ACK ve reconnect/drain’i ölçün.
3. Document/hub owner failover ve transit crypto’yu ayrı ADR’lerle tasarlayın; güvenlik modelini
   gevşeterek “HA” veya “L3” etiketi vermeyin. Privacy ve SDK production acceptance’ı kapatın.
4. Vendor/channel matrix’i doğrulanmış lab sonuçlarıyla genişletin; tam compliance ve rakip kıyas
   iddialarını bağımsız değerlendirmeden önce satışta kullanmayın.

Her kapanış kaydı: commit/digest, fixture/topology, UTC süre, test adı/rapor, gözlenen sonuç,
redakte kanıt ve reviewer. PROGRESS ürün durumları ancak bu kanıtlarla ✅ yapılmalıdır.
