# V1–V6 bağımsız denetim planı

Tarih: 2026-10-04. Bu oturum yalnız belgeleri ve izlenebilirliği kurar; uygulama kodu değiştirilmez, ürün testleri çalıştırılmaz ve mevcut “bitti” beyanları kabul kanıtı sayılmaz.

## Kapsam kilidi ve numaralandırma

[REQUIREMENTS](REQUIREMENTS.md) 3.300 satır içerir: 3.014 ürün/süreç/kabul ve 286 ASVS kontrol yükümlülüğü. Ana sorumluluk dağılımında her ID **tam bir kez** yer alır. Aralıkların iki ucu dahildir. Bir prefix bir aşamaya aittir; çapraz testler bu sahipliği değiştirmez. Yeni kaynak veya eksik alt gereksinim bulunursa prefix sonuna yeni ID eklenir, mevcut ID yeniden numaralanmaz. Plan aralıkları ve dağılım sayıları aynı değişiklikte güncellenir.

Özgün Prompt 0–35 metinleri mevcut dokümanlarda yoktur. Yol haritası PROGRESS'in 0–35 adım tablosudur; günlüğün çalışma prompt numarası ile karıştırılmaz. V1, özgün metinler sağlandığında her madde işareti/özellik/kabul kriterini bu envantere eşleyip unmatched maddeleri ekler. O zamana kadar “özgün roadmap tüm maddeleri karşılandı” kararı verilemez. Kaynakları eksiksiz yeniden oluşturma sınırı REQUIREMENTS'te açıklanmıştır.

## Ana kapsam tablosu

| Denetim | Alan | Kaynak Prompt | Ana ID aralıkları | Satır sayısı |
| --- | --- | --- | --- | ---: |
| V1 | Anayasa, repo, şema, geliştirme ortamı, veri ve API | 0, 1, 2, 3, 4, 5 | CONST-001–CONST-078; ARCH-001–ARCH-008; REPO-001–REPO-051; SHARED-001–SHARED-009; SCHEMA-001–SCHEMA-048; DEV-001–DEV-020; DATA-001–DATA-044; API-001–API-057 | 315 |
| V2 | Audit, auth, SAML, SCIM, yetki ve güvenli launch | 6, 7, 8, 9, 10, 23 | AUDIT-001–AUDIT-129; AUTH-001–AUTH-063; SAML-001–SAML-048; SCIM-001–SCIM-036; AUTHZ-001–AUTHZ-050; LAUNCH-001–LAUNCH-086 | 412 |
| V3 | UI, runtime/core/expression, agent, session, SDK ve kanallar | 11, 12, 13, 24, 25, 27, 30 | UI-001–UI-075; CORE-001–CORE-113; EXPR-001–EXPR-051; SESSION-001–SESSION-046; AGENT-001–AGENT-045; DRAFT-001–DRAFT-044; COMP-001–COMP-030; SDK-001–SDK-033; CHANNEL-001–CHANNEL-024 | 461 |
| V4 | Lifecycle/routing, designer, flow/rule, collaboration ve debugger | 14, 15, 26, 28, 29, 33, 34 (34: yalnız DEBUG) | LIFE-001–LIFE-073; ROUTE-001–ROUTE-058; DND-001–DND-051; STUDIO-001–STUDIO-029; FLOW-001–FLOW-048; RULE-001–RULE-055; TEAM-001–TEAM-051; COLLAB-001–COLLAB-058; DEBUG-001–DEBUG-086 | 509 |
| V5 | Integration proxy, protokoller, connector ve platform adapterları | 16, 17, 18, 19, 20, 21, 22 | INT-001–INT-033; SSRF-001–SSRF-028; INTUI-001–INTUI-043; PROTO-001–PROTO-016; CONN-001–CONN-080; GC-001–GC-060; GE-001–GE-059; AVAYA-001–AVAYA-071; MARKET-001–MARKET-096 | 486 |
| V6 | Analytics/admin, AI, hardening, compliance, kalite, operasyon ve rekabet | 31, 32, 34, 35 (34: yalnız AI) | ANALYTICS-001–ANALYTICS-081; ADMIN-001–ADMIN-088; AI-001–AI-096; HARDEN-001–HARDEN-032; PCI-001–PCI-037; CRYPTO-001–CRYPTO-023; PRIVACY-001–PRIVACY-031; KVKK-001–KVKK-020; SUPPLY-001–SUPPLY-026; QA-001–QA-086; OBS-001–OBS-039; PERF-001–PERF-037; SLO-001–SLO-017; DEPLOY-001–DEPLOY-083; ROLLOUT-001–ROLLOUT-021; DR-001–DR-062; DOCS-001–DOCS-043; BENCH-001–BENCH-009; ASVS-001–ASVS-286 | 1117 |

## Yürütme sırası ve bağımlılıklar

V1 → V2 → V3 → V4 → V5 → V6 rapor sırasıdır. V5 canlı ortam/hesap hazırlığı V1 sırasında başlatılır; runtime ve designer integration testleri V5 bulgularıyla tekrar ilişkilendirilir. V2 launch doğrulaması V5 platform identity/context ile, V3 kanal/sandbox doğrulaması V5 gerçek connector eventleriyle, V4 collaboration owner-loss V6 DR/chaos ile, V6 AI/audit/privacy kontrolleri V2 hash chain ve V3 redaction ile çapraz kontrol edilir. Çapraz kontrol sonucu ana ID sahibinin raporuna girer; ikinci TAM sayımı yapılmaz.

## V1 — Anayasa, repo, şema, geliştirme ortamı, veri ve API

Yöntem: Özgün prompt mutabakatı → workspace/lockfile/build → schema sınır/migration/fixture → DB constraints/tenant/RLS/transaction → API validation/error/OpenAPI.

Çıkış: 36 prompt için kaynak kapsamı açıkça kaydedilir. Repo/module hedefleri ve schema version uyumu doğrulanır; eksik kaynaklar kapatılmadan özgün kapsamın tamlığı ilan edilmez.

## V2 — Audit, auth, SAML, SCIM, yetki ve güvenli launch

Yöntem: İki tenant, iki user, çoklu role ve IdP fixture; OIDC/SAML replay/signature/issuer/audience/expiry/CSRF; SCIM lifecycle; IDOR; launch concurrent redeem; audit chain/anchor bozulması ve SIEM/export.

Çıkış: Tek kullanımlı user/interaction-bound launch ve fail-closed yetki/audit yolları gerçek negatif testlerle kanıtlanır. Gerçek IdP gerektiren sonuçlar ayrı 🔒 kaydedilir.

## V3 — UI, runtime/core/expression, agent, session, SDK ve kanallar

Yöntem: Runtime mount/unmount/session isolation; expression kötü niyetli corpus ve bütçeler; legal gate, validation, outcome; iframe/SDK sandbox ve SRI; TR/EN, keyboard ve manuel VoiceOver/NVDA.

Çıkış: Agent kritik akışları ve izolasyon senaryoları kanıtlanır; ekran görüntüsü davranış testinin yerine geçmez. Kanal listesi gerçek event kapsamıyla eşleştirilir.

## V4 — Lifecycle/routing, designer, flow/rule, collaboration ve debugger

Yöntem: Drag/drop + keyboard eşdeğerliği; draft concurrency/undo; graph cycle/orphan/decision/loop; publish immutable/checksum/diff/rollback; çok istemcili Yjs çatışma/owner loss; breakpoint/redacted replay.

Çıkış: Designer’dan runtime’a round-trip, sürüm provenance ve release-head rollback doğrulanır. Single-owner ve tarihsel replay sınırları açıkça raporlanır.

## V5 — Integration proxy, protokoller, connector ve platform adapterları

Yöntem: SSRF/DNS-rebinding/redirect/private-IP/timeout/response-size; secret browser/log isolation; connector capability matrix; canonical event mapping/order/retry/idempotency; outbound/disposition/recording pause; vendor sandbox contract.

Çıkış: Her adapter capability gerçek production path ile eşleştirilir. Facade, TODO ve canned response ayrı 🧪; erişilemeyen vendor yalnız 🔒. Mock/contract başarısı live başarıya yükseltilmez.

## V6 — Analytics/admin, AI, hardening, compliance, kalite, operasyon ve rekabet

Yöntem: Analytics denominator/window/export/A-B; admin tenant enforcement; AI opt-in/PII/prompt injection/schema gate; PCI hosted fields; retention/DSAR/KVKK; 286 ASVS kontrolü; coverage, load/RUM, chaos, DR restore, air-gap install, benchmark.

Çıkış: Ölçümler ortam/örneklem/percentile ile raporlanır. Kritik/yüksek release blocker kapanmadan GA kabulü yok; dış sistem blokları ve kapsam dışı gerekçeler görünür kalır.

## Kanıt protokolü ve durum ataması

Denetim başlangıcında git HEAD, branch, staged/unstaged diff fingerprint, lockfile, Node/pnpm/browser/DB sürümleri, config ve test fixture kimlikleri kaydedilir. Kirli çalışma ağacı varsa yalnız commit SHA yeterli değildir. Bu oturumdaki mevcut değişiklikler temizlenmez veya sahiplenilmez. Secret/token/PII kanıt dosyalarına alınmaz; redacted fixture kullanılır.

Her ID için beklenen davranış, pozitif/negatif senaryo, çalışma komutu/test adı, gözlenen sonuç, UTC zamanı, ortam ve uygulama+test **dosya:satır** referansları kaydedilir. Sonraki oturumlarda kanıtlar `docs/verification/evidence/V1/` … `V6/` altında; aşama raporları `docs/verification/V1_REPORT.md` … `V6_REPORT.md` altında tutulur. Bu oturumda sahte/boş başarı raporu oluşturulmaz. Kanıt hücresi kısa dosya:satır referansları ve yürütme artifact bağlantısı taşır; uzun açıklama rapordadır.

- ✅ TAM: kod var, ilgili test var, test geçiyor ve dosya:satır kanıtı var; manuel/ölçüm yükümlülüklerinde gerekli gözlem/ölçüm raporu ayrıca bulunur. Doküman/süreç maddelerinde o yükümlülüğün uygulanabilir karşılığı ve doğrulama kaydı açıkça yazılır; belgedeki “tamamlandı” ifadesi tek başına yeterli değildir.
- ⚠️ KISMİ: kod var fakat eksik, test yok veya bazı senaryolar başarısız. Eksik hücresinde karşılanmayan alt şart ve yeniden doğrulama yazılır.
- ❌ YOK: production uygulaması yok. İlgili endpoint/component adı bile tek başına uygulama sayılmaz.
- 🧪 STUB: production yolu iskelet, mock, TODO veya canned/fake cevap. Test fixture mock'u, gerçek uygulamanın STUB olduğunun otomatik kanıtı değildir.
- 🔒 DOĞRULANAMADI: gerçek Genesys/Avaya/IdP, PSP, WORM/SIEM gibi dış bağımlılık nedeniyle doğrulama yapılamadı. Gereken ortam/credential/işlem ve yerelde doğrulanan kısmı raporla; yerel eksikleri bu etiketle örtme.

Skip/xfail/timeout geçiş sayılmaz. Toplam test sayısı gereksinim kapsamı değildir. Aynı genel test 20 ID için kanıt gösteriliyorsa her ID'nin ayrı assertion/senaryo karşılığı açıklanır. Coverage yalnız aggregate olarak kabul edilmez; [TESTING](../TESTING.md) alan eşikleri ve [CLAUDE](../../CLAUDE.md) kritik kapsam yükümlülükleri birlikte değerlendirilir. Daha güncel ADR eski tasarımın yerine geçiyorsa karar/versiyon raporda belirtilir.

ASVS manifestinde tam kontrol metni yoktur. V6 başlamadan pinli OWASP ASVS 4.0.3 kaynağı ve checksum doğrulanır, her ASVS ID'nin tam metni okunur ve acceptance/uygulanabilirlik kararı yazılır. N/A beşli durum sözlüğüne yeni durum olarak eklenmez; gerekçe, kapsam kararı ve kabul onayı raporda tutulur. Baseline satırı sessizce silinmez; gerekçeli kapsam dışı kontrol TAM istatistiğine katılmaz.

## Rapor ve tamamlanma kapısı

Her V raporu kapsanan ID sayısı, beş durumun sayımları, boş/değerlendirilmemiş sayısı, kapsam dışı kararlar, kritik/yüksek bulgular ve yeniden test kuyruğunu içerir. Kapalı ID sayısı + açık ID sayısı + gerekçeli kapsam dışı ID sayısı, ana kapsam toplamına eşit olmalıdır. Hiçbir boş ID rapor dışında kalamaz. V1–V6'nın bitmesi bütün maddelerin TAM olduğu anlamına gelmez; eksikler açıkça teslim edilir. Kod düzeltmesi ayrı yetkilendirilmiş oturuma bırakılır.

Rekabet iddiaları [COMPETITIVE_MATRIX](COMPETITIVE_MATRIX.md) ile çapraz eşlenir. 17 temel yetenek ve COMPETITIVE.md'nin 18 farklılaştırıcısı için gerçek kıyas sonucu yoksa “üstün” kararı yok. Performans/AHT/a11y ve entegrasyon süreleri BENCH-001–BENCH-009 üzerinden ölçülür.

## Okunan kaynakların başlangıç fingerprint'i

CLAUDE.md ve docs altındaki 77 dosya (Markdown, JSON ve SQL dahil) kaynak corpus'tur. Aşağıdaki SHA-256 değerleri bu oturumun denetim belgeleri ve PROGRESS günlük eki **öncesindeki** kaynak anını kaydeder. Oluşturulan verification belgeleri kaynak corpus'una döngüsel biçimde dahil edilmez. Hash, dokümanın doğruluğunu değil okunan sürümünü tanımlar.

| Kaynak | Satır | SHA-256 |
| --- | ---: | --- |
| [CLAUDE.md](../../CLAUDE.md) | 139 | `3656125833517014d58d31c54dd9a0962d8b66daa26e34962a9fbb7b8db17f69` |
| [docs/AGENT_DESKTOP.md](../AGENT_DESKTOP.md) | 99 | `eb16ce9bcaf22c7cad160a16359ee957b7d3983f79b3666173710ce0dff11e77` |
| [docs/ARCHITECTURE.md](../ARCHITECTURE.md) | 345 | `8548f4c536e070b40a37e185f42f8f9c4d4f0f32c7604fd0f2ec7f683deae262` |
| [docs/COMPETITIVE.md](../COMPETITIVE.md) | 51 | `99319154d5113af1ec74d66f5f67e729111cd861d1938db2b79c348ea1008adc` |
| [docs/DEMO.md](../DEMO.md) | 104 | `835ab28af7432f2073e0aa72bd63b35bece8e318d990b30fbca09080877aca4c` |
| [docs/DESIGNER_LIFECYCLE.md](../DESIGNER_LIFECYCLE.md) | 81 | `845804488d5a3a8fac34128abc5cb0d1473b845f4bc0ae1231e6d121826909da` |
| [docs/DESIGNER_PREVIEW.md](../DESIGNER_PREVIEW.md) | 40 | `3323009daf1d9edeb175735beb44e6bba5d526fe9c8027352547f5b3fb8f393d` |
| [docs/DOMAIN.md](../DOMAIN.md) | 401 | `9743918680828d6691f90afa3e1dd8fe1037eb5168cfe124a035e111298ee392` |
| [docs/FINAL_AUDIT.md](../FINAL_AUDIT.md) | 129 | `66061149af30263bb4be38a092fab39286438a6ed6dfb0ecab6203b7bfc32843` |
| [docs/PROGRESS.md](../PROGRESS.md) | 966 | `e113701e716536df7fb1be3f6327829e2abb1574c47052543e4f326af7bb83ad` |
| [docs/ROADMAP.md](../ROADMAP.md) | 55 | `750eadde7778f2c8ee00182916ee85287a907c6506f3da16544af21404b072bf` |
| [docs/SCRIPT_MODEL.md](../SCRIPT_MODEL.md) | 271 | `d22acf71b2ef89cc0a0fdcd0f946320ce5c87a554a85099a179ce15ea6a42e12` |
| [docs/SECURITY.md](../SECURITY.md) | 265 | `a61692a7da19dc2d24aaa7dddf879efc78cdeab7d2706c82377bff1c6c9b058d` |
| [docs/TESTING.md](../TESTING.md) | 226 | `a14bca32392a00043b92421135bb18bd3e2da615dd70ab9a9cc8b8d3224237c3` |
| [docs/VERIFICATION_2026-10-03.md](../VERIFICATION_2026-10-03.md) | 216 | `e29c2b98ae0cd9449d6cda95365bc409a043d4af780fc52833850405af7f2271` |
| [docs/adr/0001-monorepo.md](../adr/0001-monorepo.md) | 20 | `a8ad372c978c0d2fd0355406a5275e20b4b77695eb7b191cbb0173dbcc28eb9c` |
| [docs/adr/0002-nestjs-fastify.md](../adr/0002-nestjs-fastify.md) | 21 | `19755b40e52f606dccd87159e3dfe6d9a0f3196fb334e29424eb12910773f900` |
| [docs/adr/0003-postgres-prisma.md](../adr/0003-postgres-prisma.md) | 26 | `e732b9a25bcd177a367977604ea2ff455a747c3360b910e248358f8220929033` |
| [docs/adr/0004-bff-auth.md](../adr/0004-bff-auth.md) | 26 | `90f8d4dc8c280eaf816f7e6bdc9f1123ac3fa4835e070c6f0759e833cec69d6e` |
| [docs/adr/0005-nats-event-bus.md](../adr/0005-nats-event-bus.md) | 25 | `f630f2e2cdffd1b17401284b4b54c8893f8b20989c72837894a33c5e92d0e32a` |
| [docs/adr/0006-json-script-model.md](../adr/0006-json-script-model.md) | 21 | `46ac2a25edb66c380172bf22eba48922f9123f8814d1f5f5c7de2049475c7320` |
| [docs/adr/0007-safe-expression-engine.md](../adr/0007-safe-expression-engine.md) | 28 | `e7f00356b18ffc736c806def988e372607ccc25bc8e53cb406a3da296a2e2f24` |
| [docs/adr/0008-adapter-based-connectors.md](../adr/0008-adapter-based-connectors.md) | 28 | `92acfc8c65c97413d3262b10db5e8e09255c7fb2638ff3ccb2bf2452e587ef99` |
| [docs/adr/0009-workspace-layout.md](../adr/0009-workspace-layout.md) | 54 | `b0a202e51887d3dd29bf86362008c8b9b913d9e868c9b6f129618393c710917a` |
| [docs/adr/0010-script-model-v1.md](../adr/0010-script-model-v1.md) | 69 | `40dba29921578f32a35071c3bc98376f8c5cf140a3812d38f699ef0bc48d00f6` |
| [docs/adr/0011-api-foundation.md](../adr/0011-api-foundation.md) | 126 | `3fc4e6882c4fb78552a06c9bd2db1c0a147338a6a8e8535993168206f1aa1a84` |
| [docs/adr/0012-identity-module.md](../adr/0012-identity-module.md) | 70 | `8980367caab71d425f18c6e2942906315f7fd3ae5d6196badef3c197a15effed` |
| [docs/adr/0013-casl-authorization.md](../adr/0013-casl-authorization.md) | 25 | `8d01f59debcb55f6979121909cec7dd14fbe5b529734aadc649d584d39db9cac` |
| [docs/adr/0014-audit-v2.md](../adr/0014-audit-v2.md) | 57 | `7f3eac0cc1b7c81e93e4705c2350b4d2a41021b8041cb07d12bda2b8550831c1` |
| [docs/adr/0015-authoring-lifecycle-routing.md](../adr/0015-authoring-lifecycle-routing.md) | 41 | `a9116f122849683a003d6dbc26e2c8a2804bae1ac14b6fdd7088251832a6c394` |
| [docs/adr/0016-runtime-session-engine.md](../adr/0016-runtime-session-engine.md) | 32 | `877e2438c8035b5bbcfb13d23d351e78a208255e21ff6a6a2bc4b34942ef6705` |
| [docs/adr/0017-secure-launch.md](../adr/0017-secure-launch.md) | 63 | `0aac756f47bf941ea8a11665eeec629775d584cf8aa115e17bc210a28aec9bf3` |
| [docs/adr/0018-connector-sdk-and-hub.md](../adr/0018-connector-sdk-and-hub.md) | 64 | `c8f83701493a92d90141452efcc80f73f205b7dcdc8b59bcad0afef7926cb0e1` |
| [docs/adr/0019-genesys-engage-connector.md](../adr/0019-genesys-engage-connector.md) | 80 | `5444ecaff7cdb65c7cd7e6f108d6bd1ad23696efea5fcfc5516cc9b6eeac5553` |
| [docs/adr/0020-avaya-connectors.md](../adr/0020-avaya-connectors.md) | 74 | `a48ac05b562522ace80353a17df9bf862c1c8ec6d236e498886c3725fe74c7f3` |
| [docs/adr/0021-marketplace-bridges.md](../adr/0021-marketplace-bridges.md) | 11 | `83666d060a99a0547b43c3a84f2885a5806c6d4f2a71cb45544ad1a86ea5291f` |
| [docs/adr/0022-component-library-and-sandbox.md](../adr/0022-component-library-and-sandbox.md) | 20 | `1f5ab12429e48c491de9e7045898a0a059f32e019793d3bd5afa9e0f3629d266` |
| [docs/adr/0023-designer-workspace-shell.md](../adr/0023-designer-workspace-shell.md) | 20 | `7ae9e8372e98d9a74311828cbc6cb2d36a7823e1a49543b8531eb316b67a3dae` |
| [docs/adr/0024-visual-screen-editor.md](../adr/0024-visual-screen-editor.md) | 33 | `aad0c9d2d9c9e5d6636d82d011ee0e9b2e6da0ad942f61817a867aab784c21ea` |
| [docs/adr/0025-flow-rule-variable-editors.md](../adr/0025-flow-rule-variable-editors.md) | 39 | `3245cafb2cd59a7828b1efc774eab1c481571be8953062afac83a32ddbf99a33` |
| [docs/adr/0026-integration-authoring.md](../adr/0026-integration-authoring.md) | 47 | `bc4b55ab4b48d068830827adb3d61b88e0f74ea759cfe7a66bb19cc81c8f4142` |
| [docs/adr/0027-preview-debugger-and-regression.md](../adr/0027-preview-debugger-and-regression.md) | 15 | `f4cd5ebca216ecf141b9cfd4c2a43823ef951bb56a783b8d612c7826aa877977` |
| [docs/adr/0028-lifecycle-collaboration-and-package-v2.md](../adr/0028-lifecycle-collaboration-and-package-v2.md) | 62 | `5ead3bae8ecd2ab602defdb7315647f090f8d74339e750eae2c9105b264f1b94` |
| [docs/adr/0029-agent-desktop-bff-and-durable-drafts.md](../adr/0029-agent-desktop-bff-and-durable-drafts.md) | 26 | `24487d83780c20781b26329ec323a52a949fbfc7aa535517d32f877c845bd32a` |
| [docs/adr/0030-admin-control-plane-and-privacy.md](../adr/0030-admin-control-plane-and-privacy.md) | 62 | `d6dad4ec3231bbf949b869de4883165348db507ad853045d10a6dcf5ee365e0d` |
| [docs/adr/0031-session-analytics-and-reporting.md](../adr/0031-session-analytics-and-reporting.md) | 21 | `a68946b6da19794ac9344ffffbb5a9e5263ae335aba876efda2bba5868eca458` |
| [docs/adr/0032-tenant-ai-and-human-review.md](../adr/0032-tenant-ai-and-human-review.md) | 37 | `c18a7e9f1d8116831c987f5ec325c906b80f6fe41b127787bcdc4f51b2c5027b` |
| [docs/adr/0033-asvs-security-boundaries.md](../adr/0033-asvs-security-boundaries.md) | 29 | `f9d467a6ce4cf5143b6a4e04c63524f805690bfed2eb52c0580ec3dd285ad204` |
| [docs/ai/README.md](../ai/README.md) | 119 | `ae7120acaa6da75ff3870993c6958b748452379ac7031d2bcc9a049637660d8f` |
| [docs/analytics/README.md](../analytics/README.md) | 60 | `96560e988b3bab15db0793544ae3456454ce2a1f72e459bc8b635676dcab0d58` |
| [docs/analytics/clickhouse.sql](../analytics/clickhouse.sql) | 9 | `9bea74543dd8e849afa3495ffd719c4ab3a91aee5afd9dfe6f0d3adbba5c3eec` |
| [docs/audit-routes.json](../audit-routes.json) | 1762 | `b5316cb0b4b1b700901c9e467b6bad51c52db3021d5e0310af3aa11156f44a8b` |
| [docs/compliance/KVKK.md](../compliance/KVKK.md) | 36 | `8d4593b5d227d20b9bbd238d6a1b5c66b26899fb5f6ffd2e7861e15bb35da66f` |
| [docs/connectors/MATRIX.md](../connectors/MATRIX.md) | 23 | `deb8668974c2eb566ec5f6daffc2602e5f04a626eae8c050d8bf9d1cd55f913e` |
| [docs/connectors/SETUP.md](../connectors/SETUP.md) | 54 | `1c2afb40076471f08b3c74eecbea1759530b202d397f2c218b00c8b54119adf0` |
| [docs/connectors/amazon-connect.md](../connectors/amazon-connect.md) | 59 | `e253f19220dea2a3d451078cdde851229fde9cb1c19b0f5817cfa23fbdb6d868` |
| [docs/connectors/avaya.md](../connectors/avaya.md) | 184 | `3022da4f990baf80e9efc1114538e28b2294b0a3aedd65e918ce57ec0d22e330` |
| [docs/connectors/cisco-finesse.md](../connectors/cisco-finesse.md) | 59 | `adee34a16c29731ca096c091450ca516f24a06114c8c3b86ebe8388357ac8e96` |
| [docs/connectors/cisco-webex.md](../connectors/cisco-webex.md) | 59 | `8b09610b85d9e30e9880557a1b488706b90c0d9c7a1adea05ebb913c4dbc1013` |
| [docs/connectors/dynamics-365.md](../connectors/dynamics-365.md) | 59 | `8ca796e80b6e0caf8829c4359fb344d5b715912bbf5617dfa7fc22c2eb6c5fc1` |
| [docs/connectors/five9.md](../connectors/five9.md) | 59 | `6a3f3c3913e900bd2ff486de3207405e321d67b8196750fb488fb548e02d88f8` |
| [docs/connectors/genesys-cloud.md](../connectors/genesys-cloud.md) | 185 | `93add550833920c2d3668866fbda2d7405806eb8ea3ddf65bf563b6039e36ab8` |
| [docs/connectors/genesys-engage.md](../connectors/genesys-engage.md) | 169 | `be6e12d3fb4f0ee38b36621db7421b642c5b7a6f112533c3bef3dbc768879a90` |
| [docs/connectors/nice-cxone.md](../connectors/nice-cxone.md) | 59 | `ef45337bdc69eb7d091b69b92b2038f33bbaa6ecaddb6372a419c16b0096c74d` |
| [docs/connectors/salesforce.md](../connectors/salesforce.md) | 59 | `43af7ef45da6c743de59626cb33fbc36fd512ad205261a7e8927461d4ba52c20` |
| [docs/connectors/twilio-flex.md](../connectors/twilio-flex.md) | 59 | `f5cd295c516f8aa4eaeea9c0954dfcccbcb8f8b187ef854fea1d57a34929fd39` |
| [docs/final-audit-documents.json](../final-audit-documents.json) | 357 | `a9f175aefd7978d9e93d087c6797c159e28fbf64bdb4c822a92384ca26ef7158` |
| [docs/i18n-inventory.json](../i18n-inventory.json) | 4526 | `04ff303d95b6c723b2469af2898e39bf86b5580fd828ecccdacf02fb342579ab` |
| [docs/ops/DR.md](../ops/DR.md) | 83 | `44fa0eddb8fa04f5e5e9a5cf16552eb09849b08348ae65642cb7bb95a0ef7804` |
| [docs/ops/INSTALL_ONPREM.md](../ops/INSTALL_ONPREM.md) | 165 | `6b97ca1f88f35faecbd5711a0641d0f5e839c8e0c991ffca2cd661a100e0fdd8` |
| [docs/ops/PERFORMANCE.md](../ops/PERFORMANCE.md) | 90 | `aadbacf805a6b495f8e7bdde48b35bcc404104da603d0d28866caa487e13d42c` |
| [docs/ops/ROLLOUT.md](../ops/ROLLOUT.md) | 39 | `297e752609d5707cb6dfc365afb0976d22fad76bd98725ed22f314c3ea211e26` |
| [docs/ops/RUNBOOKS.md](../ops/RUNBOOKS.md) | 45 | `c4a4db232fe139fbb9f98ea4cf1dfb1e01662a2db2870f409c21a198f4b9e990` |
| [docs/ops/SLO.md](../ops/SLO.md) | 33 | `b76280ba0d8548777d451c4868f6c333edc336177f46ba7c9ff271630bdf3d00` |
| [docs/security/ASVS_CHECKLIST.md](../security/ASVS_CHECKLIST.md) | 321 | `82432a2ab5f540406919cb18c3dd253469420a413b07a1c0aff75dfc9c85bed0` |
| [docs/security/OPERATIONS.md](../security/OPERATIONS.md) | 100 | `3341b4b768057e11a4d2e909c2da2902e2853b8966a04035a2f79e536e2a7806` |
| [docs/security/PENTEST_CHECKLIST.md](../security/PENTEST_CHECKLIST.md) | 27 | `2d4b00a43c670804ca58908d9dffded9a405d8ba33a1fbc5423a31432d1cceea` |
| [docs/security/asvs-manifest.json](../security/asvs-manifest.json) | 4912 | `ec1806f4a9efc54bea16826cb482ecaaa0468798e53ed5b1642966d46f05168c` |
