# Enterprise Core — ilk sürüm gereksinimleri ve kabul planı

Tarih: 2026-10-05. Kaynak: kullanıcının yedi başlık halinde verdiği ürün gereksinimleri. Bu belge yeni kapsamı sabitler; bir production kabul raporu değildir.

## Kabul edilen ürün hedefi

- Genel amaçlı, contact-center bağımsız agent scripting: müşteri hizmetleri, satış, tahsilat, teknik destek, retention, inbound/outbound.
- En az 10.000 kayıtlı kullanıcı, 2.000 eşzamanlı aktif agent, yüzlerce kampanya, binlerce script/screen. Bunlar test edilmesi gereken asgari kapasite hedefleri; bugünkü ölçülmüş kapasite değildir.
- Core Engine → Component System → Screen Builder → Script Runtime → Campaign Assignment. Box/Button/WebService tabanına bağlı genişletilebilir component sistemi; no-code drag/drop designer.
- Kampanyaya farklı script; tek scriptin çok kampanyaya atanması; version, test/review/publish, immutable yayın, yeni draft ve rollback.
- Server-side REST/API action; timeout/retry/error handling/circuit breaker. Dış müşteri servisiyle uçtan uca kabul ayrı olsa da bu mekanizmaların kendisi ilk sürüm kapsamındadır.
- OIDC/OAuth2, enterprise SSO, RBAC ve kullanıcı/rol/permission yönetimi; ayrıntılı audit.
- Container ile Cloud/SaaS ve On-Premise/Private Cloud; müşteriye göre veri yerleşimi ve Türkiye seçeneği; ortam configuration'ı koddan ayrı.
- Local → Development → Test → Staging → Production. Şu an ayrı staging yok; production kabulünden önce kurulacak.
- %99,9 veya üzeri erişilebilirlik hedefi; aktif interaction runtime kritik. Onaylanarak kaydedilmiş script/configuration/assignment/audit için veri kaybı kabul edilmez.

## İlk sürümün dışındaki özellikler

Genesys WDE, gerçek Genesys/Avaya/vendor connector kabulü, dış AI ve canlı AI, real-time collaborative editing ilk sürümde sunulmayacak. Bu yeteneklerin adapter/extension sınırları korunur; bugünkü kaynakları kaldırılmaz. Voice ilk kanal olabilir; context/model diğer kanalları engellemez. Chat/email/WhatsApp için gerçek feature desteği sadece mimari hazırlıktan çıkarılmaz.

Real-time collaboration kapalı ilk sürümde aralıklı collaboration sorunu core release engeli değildir. Özellik daha sonra açılmadan önce kök neden, reconnect/kayıt ve owner failover kabulü tamamlanmalıdır. Birden fazla yetkili kullanıcının aynı draft'a normal autosave yapması için version conflict/lost update koruması ilk sürümde hâlâ zorunludur.

## Güvenli yorumlanan gereksinimler

1. Dışarıdan campaign/agent/contact/interaction context'i alma, kullanıcı tarafından değiştirilebilir URL parametreleriyle script açılması anlamına gelmez. Mevcut güvenli launch: yetkili, tenant/user/interaction-bound, kısa ömürlü ve tek kullanım intent/code; doğrulanmış context server-side aktarılır. İlk vendor bağlantısı yoksa tenant'ın onaylı signed launcher yolu kullanılabilir.
2. Stateless API/application çoğaltma hedefi, PostgreSQL/Redis/NATS veya aktif runtime state'inin yok olması demek değildir. Kalıcı state ve concurrency/fencing uygulama belleğine bağımlı olmamalı; instance değişimi ve reconnect kabul edilmelidir.
3. Kaydedilmiş veride sıfır kayıp hedefi, yalnızca transaction kullanarak veya asenkron backup alarak garanti edilemez. ACK sınırı, synchronous replication/quorum ve kabul edilmiş felaket kapsamı staging/production topolojisinde doğrulanmalıdır. Bölgesel felaket için mevcut DR belgesinin 15 dakika hedefi yeni sıfır-kayıp talebiyle aynı değildir; üretim tercihi kesinleşmeden eşdeğer sayılmaz.
4. Lifecycle kaynakta draft → in_review → approved → published → retired; kullanıcının Draft/Test/Published/Archived iş hedefiyle eşlenir. Test regresyon kapısıdır; retired yayın dışına alma durumudur. Geri dönüş için yayınlı version'un değiştirilmesi gerekmez.
5. Test doubles, unit/contract testlerinde kullanılabilir. Production business işleminin success cevabı fixture/simulator ile üretilmemelidir. İlk sürüm profili simulator ve AI'ı açıkça kapatır.

## Hazırlanan kurulum profili

[values-enterprise-core.yaml](../../deploy/examples/values-enterprise-core.yaml) yalnız ilk release kapsamını seçen overlay'dir. AI_ENABLED=false, SIMULATOR_ENABLED=false, COLLABORATION_PORT=0; collaboration/hub/vendor sidecar servisleri kapalı. DB/audit worker ve üç web uygulaması korunur.

Bu overlay gerçek image digest, TLS, secrets, staging sunucusu veya kapasite sonucu içermez. Müşteriye ait site overlay ve doğrulanmış release görüntülerinden sonra uygulanmalıdır. Helm production digest/minimum replica güvenlik kapıları korunur; örnek kaynak limitlerinin 2.000 agent'ı taşıdığı varsayılmaz. Mevcut canlı yerel geliştirme servislerinin ayarı değiştirilmedi.

Profile hazırlanırken bulunan dağıtım hatası düzeltildi: kapalı collaboration için nginx artık olmayan service DNS adresine proxy yapmaz, ilgili endpoint 404 döner. Kapalı hub için API boş URL alır. Explicit stable routing ile canary kullanımında eski owner servisine yönlendirme korunur.

Kanıt: önce başarısız profile testi; son Helm/script suite **12/12**. Production policy ile sentetik immutable digest render kontrolü geçti; gerçek image veya cluster kabulü değildir. AI/collaboration servis testleri **61/61**; disabled backend davranışları dahil. [Önce](evidence/enterprise-core-scope-20261005/profile-before.log), [sonra](evidence/enterprise-core-scope-20261005/profile-final.log), [capability testleri](evidence/enterprise-core-scope-20261005/disabled-capabilities.log).

## Core release kabul matrisi

| Alan | Mevcut kanıt | Kalan kabul |
| --- | --- | --- |
| Designer/component/undo/kurallar | Son editör 341 unit + 200 Chromium; 72 component ekleme/sekme/undo/redo | Gerçek iş hikayeleri, büyük script/dataset ve aynı release'te tüm hedef tarayıcılar; test dışındaki bütün birleşimler için garanti yok |
| Version/publish/rollback/campaign | Gerçek authoring/routing transaction, immutable/SoD ve bulk rollback testleri | Çok application instance üzerinde yarışan yayın/assignment ve migration/rollback |
| Runtime / durable state | Gerçek yarışan yazma, tab fencing, rollback, tenant erişimi ve PII testleri | 2.000 bağımsız aktif session, instance kill/reconnect, ağ kopması, snapshot/cold restart |
| REST action resilience | Mevcut server-side integration engine ve güvenlik testleri | Timeout/retry/breaker/cancellation/idempotency hata matrisi; gerçek müşteri API kabulü daha sonra |
| Identity/RBAC/audit | Yerel gerçek backend testleri; 57 internal integration ve 44 security | Müşteri role/context matrisi, production cookie/TLS/edge, erişim gözden geçirme ve bağımsız inceleme |
| Audit kapasitesi | Yerel 8 tenant/500 batch, 100k olayda 51.235 olay/s; zincir testleri | 2.000 session ile karma iş yükünde throughput/backlog ve retention/restore; bu benchmark agent kapasitesi değildir |
| Multi-instance/availability | Replica/HPA/PDB ve render politikası | Hedef topolojide chaos, failover, draining ve ölçülmüş service availability |
| Zero-loss/DR | Transaction ve zincir testleri; DR runbook | Synchronous ACK/topoloji kararı, güvenli restore tatbikatı, tüm durable kayıtlar/audit anahtarları ve ölçülmüş RPO/RTO |
| Residency/on-prem | Container/Helm/secret/egress politikaları | Seçilen bölgede veya müşteri ağında kurulum; default-deny egress/telemetry/backup doğrulaması; internet erişimi olmadan kabul |

## Staging'de çalıştırılacak ölçek profili

Asgari: 10.000 sentetik kullanıcı ve 2.000 bağımsız yetkili active agent session; campaign/script/screen veri hacmi binlerle ifade edilen hedefi temsil edecek. Kampanya/script sayılarının somut fixture değerleri ayrıca kaydedilmeli; üretim limitine hard-code edilmemeli.

Mevcut k6 runner'ları K6_AGENTS ile hedeflenebilir; koda yeni müşteri sabiti eklenmez. Önerilen ilk profil: 2.000 agent, en az 60 dakika socket soak ve karma navigation/form/API/action işi; ardından kontrollü kapasite payı testi. Bunlar yürütülmüş sonuç değildir. Her koşuda release digest, instance sayısı/resources, dataset, p50/p95/p99, hata, CPU/bellek, pool/queue/backlog ve recovery süreleri kaydedilir. Her agent için ayrı yetkili session gerekir; tek session'ı tekrar etmek kapasite kabulü değildir.

Bir sonraki operasyon kararı: staging yeri/resources ve kurtarma süresi. Kullanıcı sıfır durable veri kaybı hedefini verdi; bölgesel kayıp dahil olup olmadığı ve RTO henüz kesinleşmedi. Bu bilgiler gelmeden zero-loss/SLA sözleşmesi hazır kabul edilmez. Mevcut yerel kod/test çalışmaları bu kararları beklemek zorunda değildir.

## Güncel karar

Güçlü core ürün hedefi kabul edildi ve scope overlay hazırlandı. **Genel production onayı hâlâ verilmedi.** Collaboration/AI/vendor bağlantıları hariç ilk sürüm için kapasite, durable zero-loss, failover, restore ve hedef deployment kabulü tamamlanmalıdır. Rakibe üstünlük veya müşteri sertifikası bu hedeflerden otomatik türetilmez.
